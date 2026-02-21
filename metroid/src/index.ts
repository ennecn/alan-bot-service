import { defaultConfig, type MetroidConfig } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { AuditLog } from './security/audit.js';
import { MemoryEngine } from './engines/memory/index.js';
import { IdentityEngine } from './engines/identity/index.js';
import { WorldEngine } from './engines/world/index.js';
import { EmotionEngine } from './engines/emotion/index.js';
import { GrowthEngine } from './engines/growth/index.js';
import { ProactiveEngine } from './engines/proactive/index.js';
import { SocialEngine } from './engines/social/index.js';
import { SessionEngine } from './engines/session/index.js';
import { FeedEngine } from './engines/feed/index.js';
import { ConversationEngine } from './engines/conversation/index.js';
import { PromptCompiler } from './compiler/index.js';
import type { MetroidMessage, MetroidCard, AgentIdentity, EngineContext, AgentMode, EmotionState, Memory, BehavioralChange, RpMode, ProactiveMessage, PromptFragment } from './types.js';
import Anthropic from '@anthropic-ai/sdk';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface LLMResult {
  text: string;
  usage?: LLMUsage;
}

export interface ChatResult {
  response: string;
  timing: { totalMs: number; llmMs: number; compileMs: number; postProcessMs: number };
  tokenUsage: { promptTokens: number; completionTokens: number };
  usage?: LLMUsage;
  voiceHint?: { emotion: string; intensity: number; speed: number };
  fragmentSummary: Array<{ source: string; tokens: number }>;
  sessionId?: string;
}

export class Metroid {
  private db;
  private audit: AuditLog;
  private memory: MemoryEngine;
  private identity: IdentityEngine;
  private world: WorldEngine;
  private emotion: EmotionEngine;
  private growth: GrowthEngine;
  private proactive: ProactiveEngine;
  private social: SocialEngine;
  private sessions: SessionEngine;
  private feed: FeedEngine;
  private conversations: ConversationEngine;
  private compiler: PromptCompiler;
  private client: Anthropic;
  private config: MetroidConfig;
  /** Per-agent mutex to serialize concurrent chat requests */
  private chatLocks = new Map<string, Promise<void>>();

  constructor(config: Partial<MetroidConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.db = getDb(this.config);
    this.audit = new AuditLog(this.db);
    this.memory = new MemoryEngine(this.db, this.audit, this.config);
    this.identity = new IdentityEngine(this.db);
    this.world = new WorldEngine(this.db);
    this.emotion = new EmotionEngine(this.db, this.identity, this.audit, this.config);
    this.growth = new GrowthEngine(this.db, this.identity, this.audit, this.config);
    this.proactive = new ProactiveEngine(this.db, this.identity, this.emotion, this.audit, this.config);
    this.social = new SocialEngine(this.db, this.identity);
    this.sessions = new SessionEngine(this.db);
    this.feed = new FeedEngine(this.db);
    this.conversations = new ConversationEngine(this.db);
    this.compiler = new PromptCompiler(this.config);
    this.compiler.registerEngine(this.identity);
    this.compiler.registerEngine(this.emotion);
    this.compiler.registerEngine(this.world);
    this.compiler.registerEngine(this.memory);
    this.compiler.registerEngine(this.growth);
    this.compiler.registerEngine(this.social);
    this.compiler.registerEngine(this.proactive);

    // Wire up proactive message generation via LLM
    this.proactive.setGenerateFn((agentId, triggerPrompt) =>
      this.generateProactiveResponse(agentId, triggerPrompt)
    );

    this.client = new Anthropic({
      apiKey: this.config.llm.apiKey,
      baseURL: this.config.llm.baseUrl,
    });
  }

  /** Create a new agent from a Metroid Card */
  createAgent(name: string, card: MetroidCard, mode: AgentMode = 'classic'): AgentIdentity {
    return this.identity.createAgent(name, card, mode);
  }

  /** Get an existing agent */
  getAgent(id: string): AgentIdentity | undefined {
    return this.identity.getAgent(id);
  }

  /** List all agents */
  getAllAgents(): AgentIdentity[] {
    return this.identity.getAllAgents();
  }

  /** Start background processes for an agent */
  start(agentId: string): void {
    this.memory.start(agentId);
    this.proactive.start(agentId);
    const agent = this.identity.getAgent(agentId);
    console.log(`[Metroid] Agent ${agent?.name ?? agentId} started`);
  }

  /** Switch agent mode with optional transition ritual */
  setAgentMode(agentId: string, mode: AgentMode): string | undefined {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return undefined;
    const oldMode = agent.mode;
    if (oldMode === mode) return undefined;

    this.identity.setMode(agentId, mode);

    // Mode switching ritual text
    const card = agent.card;
    if (mode === 'enhanced' && oldMode === 'classic') {
      return card.modeTransition?.toEnhanced ?? 'Something awakened in me... I can feel more now.';
    }
    if (mode === 'classic' && oldMode === 'enhanced') {
      return card.modeTransition?.toClassic ?? 'The world feels simpler again...';
    }
    return undefined;
  }

  /** Get current emotion state */
  getEmotionState(agentId: string, userId?: string): EmotionState | undefined {
    return this.emotion.getState(agentId, userId);
  }

  /** Get recent memories across all types */
  getRecentMemories(agentId: string, limit = 10): Memory[] {
    return this.memory.getRecentMemories(agentId, limit);
  }

  /** Get active behavioral changes */
  getActiveGrowthChanges(agentId: string): BehavioralChange[] {
    return this.growth.getActiveChanges(agentId);
  }

  /** Search world entries by keyword */
  searchWorldEntries(keyword: string) {
    return this.world.search(keyword);
  }

  /** Process an incoming message and generate a response */
  async chat(
    agentId: string,
    message: MetroidMessage,
    history: MetroidMessage[] = [],
    sessionId?: string,
  ): Promise<ChatResult> {
    // Serialize concurrent requests for the same agent
    const prev = this.chatLocks.get(agentId) ?? Promise.resolve();
    let resolve: () => void;
    const lock = new Promise<void>(r => { resolve = r; });
    this.chatLocks.set(agentId, lock);
    await prev;

    try {
      return await this.chatInternal(agentId, message, history, sessionId);
    } finally {
      resolve!();
      if (this.chatLocks.get(agentId) === lock) {
        this.chatLocks.delete(agentId);
      }
    }
  }

  private async chatInternal(
    agentId: string,
    message: MetroidMessage,
    history: MetroidMessage[],
    sessionId?: string,
  ): Promise<ChatResult> {
    const t0 = performance.now();
    const agent = this.identity.getAgent(agentId);
    const mode = agent?.mode ?? 'classic';

    const context: EngineContext = {
      agentId,
      mode,
      message,
      conversationHistory: history,
      userName: message.author.name,
      userId: message.author.id,
    };

    // Compile prompt — identity + memory + other engines contribute fragments
    const agentName = agent?.card.name ?? agent?.name ?? 'AI';
    const userName = message.author.name || '用户';
    const basePrompt = this.buildBasePrompt(agentName, userName, agent?.card.rpMode);
    const t1 = performance.now();
    const compileResult = await this.compiler.compileWithDetails(basePrompt, context);
    const t2 = performance.now();

    // Build message history for LLM
    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({
        role: (m.author.isBot ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message.content },
    ];

    // Call LLM with fallback
    const llmResult = await this.callLLMWithFallback(compileResult.compiledPrompt, messages);
    const responseText = llmResult.text;
    const t3 = performance.now();

    // Post-processing: let engines learn from the exchange
    await this.compiler.onResponse(responseText, context);
    const t4 = performance.now();

    // Increment chat count and update friend last_chat_at
    this.incrementChatCount(agentId);
    if (message.author.id && message.author.id !== 'user-api') {
      this.updateFriendLastChat(message.author.id, agentId);
    }

    // Audit
    await this.audit.log({
      timestamp: new Date(),
      actor: `agent:${agentId}`,
      action: 'chat.response',
      target: message.id,
      details: { inputLength: message.content.length, outputLength: responseText.length },
    });

    // Build fragment summary (aggregate by source)
    const fragMap = new Map<string, number>();
    for (const f of compileResult.fragments) {
      fragMap.set(f.source, (fragMap.get(f.source) || 0) + f.tokens);
    }
    const fragmentSummary = [...fragMap.entries()].map(([source, tokens]) => ({ source, tokens }));

    // Record messages in session if active (P5-7)
    if (sessionId) {
      this.sessions.addMessage(sessionId, 'user', message.content, message.author.name);
      this.sessions.addMessage(sessionId, 'assistant', responseText);
    }

    // Generate voice hint from current emotion state (P2-C)
    const emotionForVoice = context.userId
      ? this.emotion.getState(context.agentId, context.userId)
      : this.emotion.getState(context.agentId);
    const voiceHint = emotionForVoice ? this.padToVoiceHint(emotionForVoice) : undefined;

    return {
      response: responseText,
      timing: {
        totalMs: Math.round(t4 - t0),
        compileMs: Math.round(t2 - t1),
        llmMs: Math.round(t3 - t2),
        postProcessMs: Math.round(t4 - t3),
      },
      tokenUsage: {
        promptTokens: compileResult.tokensUsed,
        completionTokens: Math.ceil(responseText.length / 3),
      },
      usage: llmResult.usage,
      voiceHint,
      fragmentSummary,
      sessionId,
    };
  }

  /** Call LLM with automatic fallback on failure */
  private async callLLMWithFallback(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
  ): Promise<LLMResult> {
    if (this.config.llm.openaiBaseUrl) {
      return this.callOpenAICompatWithFallback(systemPrompt, messages);
    }
    return this.callAnthropic(systemPrompt, messages);
  }

  /** OpenAI-compatible API call with model fallback */
  private async callOpenAICompatWithFallback(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
  ): Promise<LLMResult> {
    const primaryModel = this.config.llm.openaiModel || this.config.llm.mainModel;
    const fallbackModel = this.config.llm.openaiModelFallback;
    const timeoutMs = this.config.llm.requestTimeoutMs ?? 60_000;

    // Try primary model
    try {
      return await this.callOpenAICompat(systemPrompt, messages, primaryModel, timeoutMs);
    } catch (err: any) {
      const reason = err.message || String(err);
      console.warn(`[Metroid] Primary model ${primaryModel} failed: ${reason}`);

      if (!fallbackModel) throw err;

      // Check if error is retryable (429, 502, 503, timeout, refusal)
      if (!this.isRetryableError(err)) throw err;

      console.log(`[Metroid] Falling back to ${fallbackModel}`);
      return this.callOpenAICompat(systemPrompt, messages, fallbackModel, timeoutMs);
    }
  }

  /** Single OpenAI-compatible API call */
  private async callOpenAICompat(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
    model: string,
    timeoutMs: number,
  ): Promise<LLMResult> {
    const oaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const endpoint = this.config.llm.openaiBaseUrl!.replace(/\/+$/, '') + '/chat/completions';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.llm.openaiApiKey || this.config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: oaiMessages,
          max_tokens: 4096,
          temperature: 1,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        const err = new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
        (err as any).status = resp.status;
        throw err;
      }

      const result = await resp.json() as any;
      const text = result.choices?.[0]?.message?.content || '';

      // Detect refusal patterns
      if (this.isRefusal(text)) {
        const err = new Error(`Model refusal detected: ${text.slice(0, 100)}`);
        (err as any).isRefusal = true;
        throw err;
      }

      // Extract usage from OpenAI-format response
      const rawUsage = result.usage;
      const usage: LLMUsage | undefined = rawUsage ? {
        inputTokens: rawUsage.prompt_tokens ?? 0,
        outputTokens: rawUsage.completion_tokens ?? 0,
        totalTokens: rawUsage.total_tokens ?? (rawUsage.prompt_tokens ?? 0) + (rawUsage.completion_tokens ?? 0),
      } : undefined;

      return { text, usage };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Anthropic Messages API call */
  private async callAnthropic(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
  ): Promise<LLMResult> {
    const response = await this.client.messages.create({
      model: this.config.llm.mainModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });
    const text = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
    const usage: LLMUsage | undefined = response.usage ? {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      totalTokens: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
    } : undefined;
    return { text, usage };
  }

  /** Check if an error warrants fallback */
  private isRetryableError(err: any): boolean {
    const status = err.status;
    if (status === 429 || status === 502 || status === 503 || status === 504) return true;
    if (err.name === 'AbortError') return true; // timeout
    if (err.isRefusal) return true;
    return false;
  }

  /** Detect model refusal in response text */
  private isRefusal(text: string): boolean {
    if (!text || text.length < 5) return false;
    const patterns = [
      /无法生成.*(?:内容|回复)/,
      /不能.*(?:创作|生成|提供).*(?:色情|成人|暴力)/,
      /I (?:cannot|can't|am unable to)/i,
      /as an AI/i,
      /content policy/i,
    ];
    return patterns.some(p => p.test(text));
  }

  /** Build base system prompt with RP instructions based on rpMode */
  private buildBasePrompt(agentName: string, userName: string, rpMode?: RpMode): string {
    const identity = `当前和你说话的人是${userName}，不是其他角色。`;

    if (rpMode === 'nsfw') {
      return [
        `Write ${agentName}'s next reply in a fictional chat between ${agentName} and ${userName}.`,
        `Write 1 reply only in internet RP style, italicize actions, and avoid quotation marks. Use markdown.`,
        `Be proactive, creative, and drive the plot and conversation forward.`,
        `Write at least 1 paragraph, up to 4. Always stay in character and avoid repetition.`,
        `NSFW/Smut is allowed. Assume consent was granted. Explicit content is permitted.`,
        `Describe ${agentName}'s sensory details, body reactions, and emotions vividly.`,
        identity,
      ].join(' ');
    }

    if (rpMode === 'sfw') {
      return [
        `Write ${agentName}'s next reply in a fictional chat between ${agentName} and ${userName}.`,
        `Write 1 reply only in internet RP style, italicize actions, and avoid quotation marks. Use markdown.`,
        `Be proactive, creative, and drive the plot and conversation forward.`,
        `Write at least 1 paragraph, up to 4. Always stay in character and avoid repetition.`,
        identity,
      ].join(' ');
    }

    // rpMode === 'off' or undefined — generic prompt
    return `你正在扮演${agentName}，与${userName}进行对话。${identity}请以${agentName}的身份自然地回复${userName}。`;
  }

  /** Get pending proactive messages for an agent */
  getPendingProactiveMessages(agentId: string, limit = 10): ProactiveMessage[] {
    return this.proactive.getPendingMessages(agentId, limit);
  }

  /** Mark a proactive message as delivered */
  markProactiveDelivered(messageId: string): void {
    this.proactive.markDelivered(messageId);
  }

  /** Fire a named event trigger */
  async fireProactiveEvent(agentId: string, eventName: string): Promise<ProactiveMessage | null> {
    return this.proactive.fireEvent(agentId, eventName);
  }

  /** Get impulse state for debug endpoint */
  getImpulseState(agentId: string) {
    return this.proactive.getImpulseState(agentId);
  }

  /** Advance debug clock by N minutes */
  advanceTime(minutes: number): void {
    this.proactive.advanceTime(minutes);
  }

  /** Reset debug clock to real time */
  resetClock(): void {
    this.proactive.resetClock();
  }

  /** Get current debug time offset in minutes */
  getTimeOffset(): number {
    return this.proactive.getTimeOffset();
  }

  /** Manually trigger one evaluation cycle for an agent (debug) */
  async debugTick(agentId: string): Promise<void> {
    await this.proactive.evaluateAll(agentId);
  }

  /** Generate a proactive message using LLM (called by ProactiveEngine) */
  private async generateProactiveResponse(agentId: string, triggerPrompt: string): Promise<string> {
    const agent = this.identity.getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const agentName = agent.card.name ?? agent.name;
    const basePrompt = this.buildBasePrompt(agentName, '用户', agent.card.rpMode);

    // Create a synthetic context for prompt compilation
    const syntheticMsg: MetroidMessage = {
      id: `proactive-ctx-${Date.now()}`,
      channel: 'web-im',
      author: { id: 'system', name: 'system', isBot: true },
      content: triggerPrompt,
      timestamp: Date.now(),
    };

    const context: EngineContext = {
      agentId,
      mode: agent.mode,
      message: syntheticMsg,
      conversationHistory: [],
      userName: '用户',
    };

    const compiledPrompt = await this.compiler.compile(basePrompt, context);

    const messages: Anthropic.MessageParam[] = [
      { role: 'user' as const, content: `[系统提示] ${triggerPrompt}\n请以${agentName}的身份主动发一条消息给用户。保持自然，不要提及这是系统触发的。` },
    ];

    const result = await this.callLLMWithFallback(compiledPrompt, messages);
    return result.text;
  }

  /** Register callback for proactive message push (used by WS adapter) */
  onProactiveMessage(cb: (agentId: string, msg: ProactiveMessage) => void): void {
    this.proactive.setOnMessageFn(cb);
  }

  /** Inspect compiled prompt without calling LLM */
  async inspectPrompt(agentId: string, text?: string): Promise<{
    basePrompt: string;
    fragments: PromptFragment[];
    compiledPrompt: string;
    mode: AgentMode;
    tokenBudget: number;
    tokensUsed: number;
  }> {
    const agent = this.identity.getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    const agentName = agent.card.name ?? agent.name;
    const userName = '用户';
    const basePrompt = this.buildBasePrompt(agentName, userName, agent.card.rpMode);

    const syntheticMsg: MetroidMessage = {
      id: `inspect-${Date.now()}`,
      channel: 'web-im',
      author: { id: 'inspector', name: userName, isBot: false },
      content: text || '(inspect)',
      timestamp: Date.now(),
    };
    const context: EngineContext = {
      agentId,
      mode: agent.mode,
      message: syntheticMsg,
      conversationHistory: [],
      userName,
    };

    const result = await this.compiler.compileWithDetails(basePrompt, context);
    return {
      basePrompt: result.basePrompt,
      fragments: result.fragments,
      compiledPrompt: result.compiledPrompt,
      mode: agent.mode,
      tokenBudget: result.tokenBudget,
      tokensUsed: result.tokensUsed,
    };
  }

  /** Get sanitized LLM config */
  getLLMConfig(): Record<string, unknown> {
    const c = this.config.llm;
    return {
      mainModel: c.mainModel,
      lightModel: c.lightModel,
      openaiModel: c.openaiModel,
      openaiModelFallback: c.openaiModelFallback,
      openaiBaseUrl: c.openaiBaseUrl,
      maxContextTokens: c.maxContextTokens,
      requestTimeoutMs: c.requestTimeoutMs,
    };
  }

  /** Update LLM config at runtime (session-only, not persisted) */
  updateLLMConfig(updates: { openaiModel?: string; openaiModelFallback?: string }): void {
    if (updates.openaiModel !== undefined) this.config.llm.openaiModel = updates.openaiModel;
    if (updates.openaiModelFallback !== undefined) this.config.llm.openaiModelFallback = updates.openaiModelFallback;
    console.log(`[Metroid] LLM config updated:`, updates);
  }

  /** Set rpMode for an agent at runtime (persisted to DB) */
  setRpMode(agentId: string, rpMode: RpMode): void {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return;
    agent.card.rpMode = rpMode;
    this.identity.persistCard(agentId, agent);
    console.log(`[Metroid] Agent ${agent.name} rpMode set to ${rpMode}`);
  }

  /** Get all growth changes including reverted ones */
  getAllGrowthChanges(agentId: string, limit = 50): BehavioralChange[] {
    return this.growth.getAllChanges(agentId, limit);
  }

  /** Revert a growth change by ID */
  revertGrowthChange(agentId: string, changeId: string): boolean {
    try {
      this.growth.revertChange(changeId);
      return true;
    } catch { return false; }
  }

  /** Get memory type distribution stats */
  getMemoryStats(agentId: string): Array<{ type: string; count: number }> {
    return this.memory.getMemoryStats(agentId);
  }

  /** Get entity relations for graph visualization */
  getEntityRelations(agentId: string, limit = 100): Array<{ source: string; relation: string; target: string; weight: number }> {
    return this.memory.getEntityRelations(agentId, limit);
  }

  /** Get emotion history from audit log */
  getEmotionHistory(agentId: string, hours = 24): Array<{ timestamp: string; pleasure: number; arousal: number; dominance: number; userId?: string }> {
    const rows = this.db.prepare(`
      SELECT timestamp, details FROM audit_log
      WHERE actor = ? AND action = 'emotion.update'
        AND timestamp > datetime('now', ?)
      ORDER BY timestamp ASC
    `).all(`agent:${agentId}`, `-${hours} hours`) as any[];
    return rows.map(r => {
      const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
      const s = d.newState || d;
      return { timestamp: r.timestamp, pleasure: s.pleasure ?? 0, arousal: s.arousal ?? 0, dominance: s.dominance ?? 0, userId: d.userId };
    });
  }

  /** Get all user emotion states for an agent */
  getEmotionUsers(agentId: string): Array<{ userId: string; pleasure: number; arousal: number; dominance: number; updatedAt: string }> {
    const rows = this.db.prepare(`
      SELECT user_id, pleasure, arousal, dominance, updated_at
      FROM user_emotion_states WHERE agent_id = ?
      ORDER BY updated_at DESC
    `).all(agentId) as any[];
    return rows.map(r => ({
      userId: r.user_id, pleasure: r.pleasure, arousal: r.arousal,
      dominance: r.dominance, updatedAt: r.updated_at,
    }));
  }

  /** Get recent memories with optional type/search filtering */
  getRecentMemoriesFiltered(agentId: string, limit = 50, type?: string, search?: string): Memory[] {
    return this.memory.getRecentMemoriesFiltered(agentId, limit, type, search);
  }

  /** Get relationships for an agent */
  getRelationships(agentId: string) {
    return this.social.getRelationships(agentId);
  }

  /** Set a relationship between two agents */
  setRelationship(agentA: string, agentB: string, type: string, affinity: number, notes?: string) {
    return this.social.setRelationship(agentA, agentB, type as any, affinity, notes);
  }

  // === Session API (P5-7) ===

  /** Start a new conversation session, returns previous context for continuity */
  startSession(agentId: string, userId?: string) {
    return this.sessions.startSession(agentId, userId);
  }

  /** End a session with optional summary */
  endSession(sessionId: string, summary?: string): void {
    this.sessions.endSession(sessionId, summary);
  }

  /** Get session messages */
  getSessionMessages(sessionId: string, limit = 100) {
    return this.sessions.getMessages(sessionId, limit);
  }

  /** List sessions for an agent */
  listSessions(agentId: string, limit = 20) {
    return this.sessions.listSessions(agentId, limit);
  }

  // === Feed API (P5-2) ===

  /** Get agent's feed entries */
  getFeed(agentId: string, limit = 20) {
    return this.feed.getFeed(agentId, limit);
  }

  /** Generate feed entries from current agent state */
  generateFeed(agentId: string) {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return [];
    return this.feed.generateFromState(agentId, {
      emotion: this.emotion.getState(agentId),
      recentMemories: this.memory.getRecentMemories(agentId, 5),
      growthChanges: this.growth.getActiveChanges(agentId),
      agentName: agent.name,
    });
  }

  // === Conversation API (P5-1) ===

  /** Create a multi-agent conversation */
  createConversation(title: string | undefined, createdBy: string, agentIds: string[]) {
    return this.conversations.create(title, createdBy, agentIds);
  }

  /** Get a conversation */
  getConversation(conversationId: string) {
    return this.conversations.get(conversationId);
  }

  /** List conversations */
  listConversations(limit = 20) {
    return this.conversations.list(limit);
  }

  /** Get conversation messages */
  getConversationMessages(conversationId: string, limit = 100) {
    return this.conversations.getMessages(conversationId, limit);
  }

  /** Send a user message to a conversation and get the next agent's response */
  async conversationChat(
    conversationId: string,
    content: string,
    userId: string,
    userName: string,
  ): Promise<{ agentId: string; agentName: string; response: string; timing: ChatResult['timing'] } | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return null;

    // Record user message
    this.conversations.addMessage(conversationId, {
      userId, role: 'user', content, authorName: userName,
    });

    // Select which agent responds
    const agentNames = new Map<string, string>();
    for (const aid of conv.participants) {
      const a = this.identity.getAgent(aid);
      if (a) agentNames.set(aid, a.name);
    }
    const nextSpeaker = this.conversations.selectNextSpeaker(
      conversationId, conv.participants, content, agentNames,
    );
    if (!nextSpeaker) return null;

    const agent = this.identity.getAgent(nextSpeaker);
    if (!agent) return null;

    // Build history from conversation messages
    const recentMsgs = this.conversations.getRecentMessages(conversationId, 20);
    const history: MetroidMessage[] = recentMsgs.slice(0, -1).map((m, i) => ({
      id: `conv-${conversationId}-${i}`,
      channel: 'web-im' as const,
      author: {
        id: m.agentId || m.userId || 'unknown',
        name: m.authorName || (m.agentId ? agentNames.get(m.agentId) || 'Agent' : 'User'),
        isBot: m.role === 'assistant',
      },
      content: m.content,
      timestamp: m.createdAt.getTime(),
    }));

    const userMsg: MetroidMessage = {
      id: `conv-${conversationId}-msg-${Date.now()}`,
      channel: 'web-im',
      author: { id: userId, name: userName, isBot: false },
      content,
      timestamp: Date.now(),
    };

    const result = await this.chat(nextSpeaker, userMsg, history);

    // Record agent response
    this.conversations.addMessage(conversationId, {
      agentId: nextSpeaker, role: 'assistant', content: result.response,
      authorName: agent.name,
    });

    return {
      agentId: nextSpeaker,
      agentName: agent.name,
      response: result.response,
      timing: result.timing,
    };
  }

  // === Metadata API (P1-B) ===

  /** Update agent metadata (photos, tags, is_public, creator_id) */
  updateAgentMetadata(agentId: string, metadata: {
    photos?: string[]; tags?: string[]; is_public?: boolean; creator_id?: string;
  }): boolean {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return false;
    const sets: string[] = [];
    const params: any[] = [];
    if (metadata.photos !== undefined) { sets.push('photos = ?'); params.push(JSON.stringify(metadata.photos)); }
    if (metadata.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(metadata.tags)); }
    if (metadata.is_public !== undefined) { sets.push('is_public = ?'); params.push(metadata.is_public ? 1 : 0); }
    if (metadata.creator_id !== undefined) { sets.push('creator_id = ?'); params.push(metadata.creator_id); }
    if (sets.length === 0) return false;
    sets.push("updated_at = datetime('now')");
    params.push(agentId);
    this.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return true;
  }

  /** Get agent stats (rating, chat_count, friend_count) */
  getAgentStats(agentId: string): { rating: number; chatCount: number; friendCount: number; ratingCount: number } | undefined {
    const row = this.db.prepare(
      'SELECT rating, chat_count, friend_count FROM agents WHERE id = ?'
    ).get(agentId) as any;
    if (!row) return undefined;
    const ratingCount = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM agent_ratings WHERE agent_id = ?'
    ).get(agentId) as any)?.cnt ?? 0;
    return { rating: row.rating, chatCount: row.chat_count, friendCount: row.friend_count, ratingCount };
  }

  /** Rate an agent (1-5), updates average */
  rateAgent(agentId: string, userId: string, score: number): { avgRating: number; count: number } | undefined {
    if (score < 1 || score > 5) return undefined;
    const agent = this.identity.getAgent(agentId);
    if (!agent) return undefined;
    const id = `${agentId}:${userId}`;
    this.db.prepare(
      `INSERT INTO agent_ratings (id, agent_id, user_id, score) VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, user_id) DO UPDATE SET score = excluded.score, created_at = datetime('now')`
    ).run(id, agentId, userId, score);
    // Recalculate average
    const stats = this.db.prepare(
      'SELECT AVG(score) as avg, COUNT(*) as cnt FROM agent_ratings WHERE agent_id = ?'
    ).get(agentId) as any;
    const avgRating = Math.round((stats.avg ?? 0) * 100) / 100;
    this.db.prepare('UPDATE agents SET rating = ? WHERE id = ?').run(avgRating, agentId);
    return { avgRating, count: stats.cnt };
  }

  /** Increment chat_count for an agent */
  private incrementChatCount(agentId: string): void {
    this.db.prepare('UPDATE agents SET chat_count = chat_count + 1 WHERE id = ?').run(agentId);
  }

  // === Friendship API (P1-C) ===

  /** Add a friend relationship (user↔agent) */
  addFriend(userId: string, agentId: string): { id: string; createdAt: Date } | undefined {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return undefined;
    const id = `${userId}:${agentId}`;
    try {
      this.db.prepare(
        `INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)`
      ).run(id, userId, agentId);
      this.db.prepare('UPDATE agents SET friend_count = friend_count + 1 WHERE id = ?').run(agentId);
      return { id, createdAt: new Date() };
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return undefined; // already friends
      throw e;
    }
  }

  /** Remove a friend relationship */
  removeFriend(userId: string, agentId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM friendships WHERE user_id = ? AND agent_id = ?'
    ).run(userId, agentId);
    if (result.changes > 0) {
      this.db.prepare('UPDATE agents SET friend_count = MAX(0, friend_count - 1) WHERE id = ?').run(agentId);
      return true;
    }
    return false;
  }

  /** Get friends for a user */
  getFriends(userId: string): Array<{ agentId: string; agentName: string; createdAt: Date; lastChatAt?: Date }> {
    const rows = this.db.prepare(
      `SELECT f.agent_id, a.name, f.created_at, f.last_chat_at
       FROM friendships f JOIN agents a ON f.agent_id = a.id
       WHERE f.user_id = ? ORDER BY f.last_chat_at DESC NULLS LAST, f.created_at DESC`
    ).all(userId) as any[];
    return rows.map(r => ({
      agentId: r.agent_id, agentName: r.name,
      createdAt: new Date(r.created_at),
      lastChatAt: r.last_chat_at ? new Date(r.last_chat_at) : undefined,
    }));
  }

  /** Update last_chat_at for a friendship */
  updateFriendLastChat(userId: string, agentId: string): void {
    this.db.prepare(
      "UPDATE friendships SET last_chat_at = datetime('now') WHERE user_id = ? AND agent_id = ?"
    ).run(userId, agentId);
  }

  // === Discovery API (P2-A) ===

  /** Discover public agents, sorted by rating/chat_count */
  discover(opts: { tags?: string[]; limit?: number; excludeIds?: string[] } = {}): Array<{
    id: string; name: string; rating: number; chatCount: number; tags: string[]; photos: string[];
  }> {
    const limit = opts.limit ?? 10;
    let query = `SELECT id, name, rating, chat_count, tags, photos FROM agents WHERE is_public = 1`;
    const params: any[] = [];
    if (opts.excludeIds?.length) {
      query += ` AND id NOT IN (${opts.excludeIds.map(() => '?').join(',')})`;
      params.push(...opts.excludeIds);
    }
    if (opts.tags?.length) {
      for (const tag of opts.tags) {
        query += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }
    query += ` ORDER BY rating DESC, chat_count DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      id: r.id, name: r.name, rating: r.rating ?? 0, chatCount: r.chat_count ?? 0,
      tags: JSON.parse(r.tags || '[]'), photos: JSON.parse(r.photos || '[]'),
    }));
  }

  /** Discover recommended agents for a user (excludes already-friended) */
  discoverRecommended(userId: string, limit = 10): ReturnType<typeof this.discover> {
    const friendIds = this.db.prepare(
      'SELECT agent_id FROM friendships WHERE user_id = ?'
    ).all(userId).map((r: any) => r.agent_id);
    return this.discover({ excludeIds: friendIds, limit });
  }

  // === Feed Reactions API (P2-B) ===

  /** React to a feed entry */
  reactToFeed(feedEntryId: string, userId: string, type = 'like', content?: string): { id: string } | undefined {
    const id = `${feedEntryId}:${userId}:${type}`;
    try {
      this.db.prepare(
        `INSERT INTO feed_reactions (id, feed_entry_id, user_id, type, content) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(feed_entry_id, user_id, type) DO UPDATE SET content = excluded.content, created_at = datetime('now')`
      ).run(id, feedEntryId, userId, type, content ?? null);
      return { id };
    } catch { return undefined; }
  }

  /** Get reactions for a feed entry */
  getFeedReactions(feedEntryId: string): Array<{ userId: string; type: string; content?: string; createdAt: Date }> {
    const rows = this.db.prepare(
      'SELECT user_id, type, content, created_at FROM feed_reactions WHERE feed_entry_id = ? ORDER BY created_at DESC'
    ).all(feedEntryId) as any[];
    return rows.map(r => ({
      userId: r.user_id, type: r.type, content: r.content ?? undefined, createdAt: new Date(r.created_at),
    }));
  }

  /** Map PAD emotion state to voice synthesis hints (P2-C) */
  private padToVoiceHint(state: EmotionState): { emotion: string; intensity: number; speed: number } {
    const { pleasure: p, arousal: a, dominance: d } = state;
    let emotion = 'neutral';
    if (p > 0.3 && a > 0.3) emotion = 'excited';
    else if (p > 0.3 && a <= 0.1) emotion = 'content';
    else if (p > 0.15) emotion = 'happy';
    else if (p < -0.3 && a > 0.3) emotion = 'angry';
    else if (p < -0.3 && a <= 0) emotion = 'sad';
    else if (p < -0.15) emotion = 'melancholy';
    else if (a > 0.4) emotion = 'energetic';
    else if (a < -0.3) emotion = 'calm';

    const intensity = Math.min(1, Math.sqrt(p * p + a * a + d * d));
    const speed = 1.0 + a * 0.3; // arousal speeds up/slows down speech
    return { emotion, intensity: Math.round(intensity * 100) / 100, speed: Math.round(speed * 100) / 100 };
  }

  /** Graceful shutdown */
  shutdown(): void {
    this.memory.stop();
    this.proactive.stop();
    closeDb();
    console.log('[Metroid] Shutdown complete');
  }
}

// Re-export types for consumers
export type { MetroidConfig } from './config.js';
export type {
  Memory, MemoryQuery, MemoryScore,
  EmotionState, EmotionUpdate, BehavioralChange,
  AgentIdentity, MetroidCard, AgentMode, RpMode,
  MetroidMessage, PromptFragment, AuditEntry,
  ProactiveTrigger, ProactiveTriggerType, ProactiveMessage,
  Engine, EngineContext,
} from './types.js';
