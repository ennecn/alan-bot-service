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

export interface ChatResult {
  response: string;
  timing: { totalMs: number; llmMs: number; compileMs: number; postProcessMs: number };
  tokenUsage: { promptTokens: number; completionTokens: number };
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
  getEmotionState(agentId: string): EmotionState | undefined {
    return this.emotion.getState(agentId);
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
    const responseText = await this.callLLMWithFallback(compileResult.compiledPrompt, messages);
    const t3 = performance.now();

    // Post-processing: let engines learn from the exchange
    await this.compiler.onResponse(responseText, context);
    const t4 = performance.now();

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
      fragmentSummary,
      sessionId,
    };
  }

  /** Call LLM with automatic fallback on failure */
  private async callLLMWithFallback(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
  ): Promise<string> {
    if (this.config.llm.openaiBaseUrl) {
      return this.callOpenAICompatWithFallback(systemPrompt, messages);
    }
    return this.callAnthropic(systemPrompt, messages);
  }

  /** OpenAI-compatible API call with model fallback */
  private async callOpenAICompatWithFallback(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
  ): Promise<string> {
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
  ): Promise<string> {
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

      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Anthropic Messages API call */
  private async callAnthropic(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.config.llm.mainModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });
    return response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
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

    return this.callLLMWithFallback(compiledPrompt, messages);
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
