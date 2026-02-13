import type Database from 'better-sqlite3';
import type {
  Engine, EngineContext, PromptFragment,
  MemoryScore, Memory,
} from '../../types.js';
import type { MetroidConfig } from '../../config.js';
import type { AuditLog } from '../../security/audit.js';
import { MemoryStore } from './store.js';
import { MemoryRetriever } from './retriever.js';
import { MemoryEncoder } from './encoder.js';
import { MemoryForgetter } from './forgetter.js';

export class MemoryEngine implements Engine {
  readonly name = 'memory';

  private store: MemoryStore;
  private retriever: MemoryRetriever;
  private encoder: MemoryEncoder;
  private forgetter: MemoryForgetter;

  constructor(db: Database.Database, audit: AuditLog, config: MetroidConfig) {
    this.store = new MemoryStore(db);
    this.retriever = new MemoryRetriever(this.store);
    this.encoder = new MemoryEncoder(this.store, audit, config);
    this.forgetter = new MemoryForgetter(this.store, audit, config);
  }

  /** Start background processes (forgetting cycle) */
  start(agentId: string): void {
    this.forgetter.start(agentId);
  }

  stop(): void {
    this.forgetter.stop();
  }

  /** Retrieve relevant memories and format as prompt fragments */
  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    const results = await this.retriever.retrieve({
      agentId: context.agentId,
      text: context.message.content,
    });

    if (results.length === 0) return [];

    const memoryText = results
      .map(r => this.formatMemory(r))
      .join('\n');

    return [{
      source: 'memory',
      content: `<memories>\n${memoryText}\n</memories>`,
      priority: 60,
      tokens: Math.ceil(memoryText.length / 4), // rough estimate
      required: false,
    }];
  }

  /** After LLM response: encode the exchange into memory */
  async onResponse(response: string, context: EngineContext): Promise<void> {
    // Encode user message
    this.encoder.maybeEncode(
      context.agentId,
      context.message.content,
      context.message.id,
    );

    // Encode agent response (lower sampling — we care more about user input)
    if (Math.random() < 0.5) {
      this.encoder.maybeEncode(
        context.agentId,
        response,
        `response-${context.message.id}`,
      );
    }
  }

  /** Fallback when retrieval fails */
  fallback(): PromptFragment[] {
    return []; // graceful degradation: just skip memories
  }

  /**
   * Format a retrieved memory for prompt injection.
   * Confidence level affects wording (from Lumi's feedback).
   */
  private formatMemory(scored: MemoryScore): string {
    const m = scored.memory;
    const text = m.summary || m.content;
    const conf = m.confidence;

    // Confidence-based framing
    let prefix: string;
    if (conf > 0.8) {
      prefix = '确切记得';
    } else if (conf > 0.5) {
      prefix = '记得';
    } else if (conf > 0.3) {
      prefix = '好像记得';
    } else {
      prefix = '隐约记得';
    }

    const age = this.formatAge(m.createdAt);
    return `- [${prefix}, ${age}] ${text}`;
  }

  private formatAge(date: Date): string {
    const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
    if (hours < 1) return '刚才';
    if (hours < 24) return `${Math.round(hours)}小时前`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.round(days / 7)}周前`;
    return `${Math.round(days / 30)}个月前`;
  }
}

export { MemoryStore } from './store.js';
export { MemoryRetriever } from './retriever.js';
export { MemoryEncoder } from './encoder.js';
export { MemoryForgetter } from './forgetter.js';
