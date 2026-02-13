import { defaultConfig, type MetroidConfig } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { AuditLog } from './security/audit.js';
import { MemoryEngine } from './engines/memory/index.js';
import { IdentityEngine } from './engines/identity/index.js';
import { PromptCompiler } from './compiler/index.js';
import type { MetroidMessage, MetroidCard, AgentIdentity, EngineContext } from './types.js';
import Anthropic from '@anthropic-ai/sdk';

export class Metroid {
  private db;
  private audit: AuditLog;
  private memory: MemoryEngine;
  private identity: IdentityEngine;
  private compiler: PromptCompiler;
  private client: Anthropic;
  private config: MetroidConfig;

  constructor(config: Partial<MetroidConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.db = getDb(this.config);
    this.audit = new AuditLog(this.db);
    this.memory = new MemoryEngine(this.db, this.audit, this.config);
    this.identity = new IdentityEngine(this.db);
    this.compiler = new PromptCompiler(this.config);
    this.compiler.registerEngine(this.identity);
    this.compiler.registerEngine(this.memory);

    this.client = new Anthropic({
      apiKey: this.config.llm.apiKey,
      baseURL: this.config.llm.baseUrl,
    });
  }

  /** Create a new agent from a Metroid Card */
  createAgent(name: string, card: MetroidCard): AgentIdentity {
    return this.identity.createAgent(name, card);
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
    const agent = this.identity.getAgent(agentId);
    console.log(`[Metroid] Agent ${agent?.name ?? agentId} started`);
  }

  /** Process an incoming message and generate a response */
  async chat(
    agentId: string,
    message: MetroidMessage,
    history: MetroidMessage[] = [],
  ): Promise<string> {
    const context: EngineContext = {
      agentId,
      message,
      conversationHistory: history,
    };

    // Compile prompt — identity + memory + other engines contribute fragments
    const compiledPrompt = await this.compiler.compile(
      '你是一个有记忆、有情感、会成长的AI。请根据你的身份和记忆自然地回复。',
      context,
    );

    // Build message history for LLM
    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({
        role: (m.author.isBot ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message.content },
    ];

    // Call LLM
    const response = await this.client.messages.create({
      model: this.config.llm.mainModel,
      max_tokens: 4096,
      system: compiledPrompt,
      messages,
    });

    const responseText = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    // Post-processing: let engines learn from the exchange
    await this.compiler.onResponse(responseText, context);

    // Audit
    await this.audit.log({
      timestamp: new Date(),
      actor: `agent:${agentId}`,
      action: 'chat.response',
      target: message.id,
      details: { inputLength: message.content.length, outputLength: responseText.length },
    });

    return responseText;
  }

  /** Graceful shutdown */
  shutdown(): void {
    this.memory.stop();
    closeDb();
    console.log('[Metroid] Shutdown complete');
  }
}

// Re-export types for consumers
export type { MetroidConfig } from './config.js';
export type {
  Memory, MemoryQuery, MemoryScore,
  EmotionState, AgentIdentity, MetroidCard,
  MetroidMessage, PromptFragment, AuditEntry,
  Engine, EngineContext,
} from './types.js';
