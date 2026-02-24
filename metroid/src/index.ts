import { defaultConfig, type MetroidConfig } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { AuditLog } from './security/audit.js';
import { MemoryEngine } from './engines/memory/index.js';
import { IdentityEngine } from './engines/identity/index.js';
import { WorldEngine } from './engines/world/index.js';
import { EmotionEngine } from './engines/emotion/index.js';
import { GrowthEngine } from './engines/growth/index.js';
import { ProactiveEngine } from './engines/proactive/index.js';
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
}

export interface CompareResult {
  id: string;
  timestamp: string;
  message: string;
  classic: {
    fragments: PromptFragment[];
    compiledPrompt: string;
    tokensUsed: number;
    response?: string;
    timing: { compileMs: number; llmMs?: number };
  };
  enhanced: {
    fragments: PromptFragment[];
    compiledPrompt: string;
    tokensUsed: number;
    response?: string;
    timing: { compileMs: number; llmMs?: number };
  };
  judge?: {
    classicScore: number;
    enhancedScore: number;
    dimensions: Record<string, { classic: number; enhanced: number }>;
    reasoning: string;
  };
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
  private compiler: PromptCompiler;
  private client: Anthropic;
  private config: MetroidConfig;

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
    this.compiler = new PromptCompiler(this.config);
    this.compiler.registerEngine(this.identity);
    this.compiler.registerEngine(this.emotion);
    this.compiler.registerEngine(this.world);
    this.compiler.registerEngine(this.memory);
    this.compiler.registerEngine(this.growth);
    this.compiler.registerEngine(this.proactive);

    // Wire up proactive message generation via LLM
    this.proactive.setGenerateFn((agentId, triggerPrompt) =>
      this.generateProactiveResponse(agentId, triggerPrompt)
    );

    // Wire up lightweight LLM analysis for event detection (V3)
    this.proactive.setAnalyzeFn(async (prompt) => {
      const result = await this.callLLMWithFallback(
        'You are an emotion analysis assistant. Reply with valid JSON only, no markdown.',
        [{ role: 'user', content: prompt }],
      );
      return result.text;
    });

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

  /** Switch agent mode */
  setAgentMode(agentId: string, mode: AgentMode): void {
    this.identity.setMode(agentId, mode);
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
      fragmentSummary,
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

  /** Disable/enable V5 behavioral envelope for an agent (for A/B testing) */
  setEnvelopeDisabled(agentId: string, disabled: boolean): void {
    this.proactive.setEnvelopeDisabled(agentId, disabled);
  }

  isEnvelopeDisabled(agentId: string): boolean {
    return this.proactive.isEnvelopeDisabled(agentId);
  }

  /** Inject an active event directly into impulse system (for testing) */
  injectActiveEvent(agentId: string, eventName: string, intensity?: number, decayRate?: number, relevance?: number): void {
    this.proactive.injectActiveEvent(agentId, eventName, intensity, decayRate, relevance);
  }

  /** Directly set impulse value (for testing) */
  setImpulseValue(agentId: string, value: number): void {
    this.proactive.setImpulseValue(agentId, value);
  }

  /** Get current behavioral envelope state */
  getBehavioralEnvelope(agentId: string): ReturnType<typeof this.proactive.evaluateBehavioralState> | null {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return null;
    return this.proactive.evaluateBehavioralState(agentId, agent);
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

  /** V6: Register callback for inner monologue push (used by WS adapter) */
  onMonologue(cb: (agentId: string, data: { id: string; trigger: string; content: string; createdAt: number }) => void): void {
    this.proactive.setOnMonologueFn(cb);
  }

  /** V6: Get per-user relationship state */
  getRelationship(agentId: string, userId: string) {
    return this.proactive.getRelationship(agentId, userId);
  }

  /** V6: Get recent inner monologues */
  getRecentMonologues(agentId: string, limit = 10) {
    return this.proactive.getRecentMonologues(agentId, limit);
  }

  /** V6: Get behavioral envelope for a user */
  getBehavioralEnvelope(agentId: string, userId?: string) {
    const agent = this.identity.getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    return this.proactive.evaluateBehavioralState(agentId, agent, userId);
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

  /** Compare classic vs enhanced prompt compilation + optional LLM calls + judge */
  async compareChat(
    agentId: string,
    message: MetroidMessage,
    history: MetroidMessage[],
    options: { callLLM?: boolean; judge?: boolean } = {},
  ): Promise<CompareResult> {
    const agent = this.identity.getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const agentName = agent.card.name ?? agent.name;
    const userName = message.author.name || '用户';
    const basePrompt = this.buildBasePrompt(agentName, userName, agent.card.rpMode);
    const originalMode = agent.mode;

    const context = (mode: AgentMode): EngineContext => ({
      agentId, mode, message, conversationHistory: history, userName,
    });

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({
        role: (m.author.isBot ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message.content },
    ];

    // Classic compilation
    this.identity.setMode(agentId, 'classic');
    const ct0 = performance.now();
    const classicResult = await this.compiler.compileWithDetails(basePrompt, context('classic'));
    const ct1 = performance.now();

    // Enhanced compilation
    this.identity.setMode(agentId, 'enhanced');
    const et0 = performance.now();
    const enhancedResult = await this.compiler.compileWithDetails(basePrompt, context('enhanced'));
    const et1 = performance.now();

    // Restore original mode
    this.identity.setMode(agentId, originalMode);

    const result: CompareResult = {
      id: `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      message: message.content,
      classic: {
        fragments: classicResult.fragments,
        compiledPrompt: classicResult.compiledPrompt,
        tokensUsed: classicResult.tokensUsed,
        timing: { compileMs: Math.round(ct1 - ct0) },
      },
      enhanced: {
        fragments: enhancedResult.fragments,
        compiledPrompt: enhancedResult.compiledPrompt,
        tokensUsed: enhancedResult.tokensUsed,
        timing: { compileMs: Math.round(et1 - et0) },
      },
    };

    // Optional LLM calls
    if (options.callLLM) {
      const lt0 = performance.now();
      const classicLLM = await this.callLLMWithFallback(classicResult.compiledPrompt, messages);
      const lt1 = performance.now();
      result.classic.response = classicLLM.text;
      result.classic.timing.llmMs = Math.round(lt1 - lt0);

      const lt2 = performance.now();
      const enhancedLLM = await this.callLLMWithFallback(enhancedResult.compiledPrompt, messages);
      const lt3 = performance.now();
      result.enhanced.response = enhancedLLM.text;
      result.enhanced.timing.llmMs = Math.round(lt3 - lt2);

      // Optional judge
      if (options.judge && result.classic.response && result.enhanced.response) {
        result.judge = await this.judgeResponses(
          message.content, result.classic.response, result.enhanced.response, agentName,
        );
      }
    }

    return result;
  }

  /** Use LLM to judge quality of two responses */
  private async judgeResponses(
    userMessage: string, classicReply: string, enhancedReply: string, agentName: string,
  ): Promise<CompareResult['judge']> {
    const judgePrompt = `You are a quality evaluator for AI character responses. Score each response on a 1-10 scale across these dimensions:
- character_consistency: How well does the response stay in character as ${agentName}?
- emotional_depth: How rich and nuanced are the emotions expressed?
- context_usage: How well does the response use available context?
- naturalness: How natural and human-like is the response?
- creativity: How creative and engaging is the response?

User message: "${userMessage}"

Response A (classic mode):
${classicReply}

Response B (enhanced mode):
${enhancedReply}

Reply in JSON only:
{"dimensions":{"character_consistency":{"classic":N,"enhanced":N},"emotional_depth":{"classic":N,"enhanced":N},"context_usage":{"classic":N,"enhanced":N},"naturalness":{"classic":N,"enhanced":N},"creativity":{"classic":N,"enhanced":N}},"reasoning":"brief explanation"}`;

    try {
      const result = await this.callLLMWithFallback(
        'You are a response quality evaluator. Reply with valid JSON only, no markdown.',
        [{ role: 'user', content: judgePrompt }],
      );
      const parsed = JSON.parse(result.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      const dims = parsed.dimensions || {};
      let classicTotal = 0, enhancedTotal = 0, count = 0;
      for (const d of Object.values(dims) as Array<{ classic: number; enhanced: number }>) {
        classicTotal += d.classic || 0;
        enhancedTotal += d.enhanced || 0;
        count++;
      }
      return {
        classicScore: count ? Math.round(classicTotal / count * 10) / 10 : 0,
        enhancedScore: count ? Math.round(enhancedTotal / count * 10) / 10 : 0,
        dimensions: dims,
        reasoning: parsed.reasoning || '',
      };
    } catch (err: any) {
      return {
        classicScore: 0, enhancedScore: 0, dimensions: {},
        reasoning: `Judge failed: ${err.message}`,
      };
    }
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
  updateLLMConfig(updates: { openaiModel?: string; openaiModelFallback?: string; openaiBaseUrl?: string; openaiApiKey?: string }): void {
    if (updates.openaiModel !== undefined) this.config.llm.openaiModel = updates.openaiModel;
    if (updates.openaiModelFallback !== undefined) this.config.llm.openaiModelFallback = updates.openaiModelFallback;
    if (updates.openaiBaseUrl !== undefined) this.config.llm.openaiBaseUrl = updates.openaiBaseUrl;
    if (updates.openaiApiKey !== undefined) this.config.llm.openaiApiKey = updates.openaiApiKey;
    console.log(`[Metroid] LLM config updated:`, updates);
  }

  /** Set rpMode for an agent at runtime */
  setRpMode(agentId: string, rpMode: RpMode): void {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return;
    agent.card.rpMode = rpMode;
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

  /** Get recent memories with filtering */
  getRecentMemoriesFiltered(agentId: string, limit = 50, type?: string, search?: string): Memory[] {
    return this.memory.getRecentMemoriesFiltered(agentId, limit, type, search);
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

  /** Get list of users who have emotion states with this agent */
  getEmotionUsers(agentId: string): Array<{ userId: string; state: any }> {
    const rows = this.db.prepare(`
      SELECT DISTINCT json_extract(details, '$.userId') as userId
      FROM audit_log
      WHERE actor = ? AND action = 'emotion.update'
        AND json_extract(details, '$.userId') IS NOT NULL
    `).all(`agent:${agentId}`) as any[];
    return rows.filter(r => r.userId).map(r => ({
      userId: r.userId,
      state: this.emotion.getState(agentId, r.userId),
    }));
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
