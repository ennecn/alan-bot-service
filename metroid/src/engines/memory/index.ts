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
import { EmbeddingService } from './embedding.js';
import { GraphRAG } from './graph-rag.js';

export class MemoryEngine implements Engine {
  readonly name = 'memory';

  private store: MemoryStore;
  private retriever: MemoryRetriever;
  private encoder: MemoryEncoder;
  private forgetter: MemoryForgetter;
  private embedding: EmbeddingService;
  private graphRag: GraphRAG;

  constructor(db: Database.Database, audit: AuditLog, config: MetroidConfig) {
    this.store = new MemoryStore(db);
    this.embedding = new EmbeddingService(config);
    this.graphRag = new GraphRAG(db, config);
    this.retriever = new MemoryRetriever(this.store, this.embedding);
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
    const fragments: PromptFragment[] = [];

    // Standard memory retrieval (keyword + vector)
    const results = await this.retriever.retrieve({
      agentId: context.agentId,
      text: context.message.content,
    });

    if (results.length > 0) {
      const memoryText = results
        .map(r => this.formatMemory(r))
        .join('\n');

      fragments.push({
        source: 'memory',
        content: `<memories>\n${memoryText}\n</memories>`,
        priority: 60,
        tokens: Math.ceil(memoryText.length / 4),
        required: false,
      });
    }

    // Graph-based entity context (fast local extraction, no LLM call)
    try {
      const entities = this.graphRag.extractEntitiesLocal(context.message.content);
      if (entities.length > 0) {
        const related = this.graphRag.findRelatedEntities(context.agentId, entities, 10);
        if (related.length > 0) {
          const graphContext = `<entity_context>\n相关联的人/事/物: ${related.join(', ')}\n</entity_context>`;
          fragments.push({
            source: 'memory',
            content: graphContext,
            priority: 40,
            tokens: Math.ceil(graphContext.length / 4),
            required: false,
          });
        }
      }
    } catch (err) {
      // Graph query failure is non-fatal
      console.warn('[MemoryEngine] Graph query failed:', err);
    }

    return fragments;
  }

  /** After LLM response: encode the exchange into memory */
  async onResponse(response: string, context: EngineContext): Promise<void> {
    // Encode user message — always store
    this.encoder.encode(
      context.agentId,
      context.message.content,
      context.message.id,
    );

    // Encode agent response — always store
    this.encoder.encode(
      context.agentId,
      response,
      `response-${context.message.id}`,
    );

    // Generate embeddings async (non-blocking)
    this.generateEmbeddingsAsync(context.agentId, [
      { text: context.message.content, messageId: context.message.id },
      { text: response, messageId: `response-${context.message.id}` },
    ]);

    // Extract entity relations async (non-blocking)
    const combinedText = `${context.message.content}\n${response}`;
    this.graphRag.extractRelations(context.agentId, combinedText)
      .catch(() => {}); // swallow errors
  }

  /** Async embedding generation — does not block conversation */
  private generateEmbeddingsAsync(
    agentId: string,
    items: Array<{ text: string; messageId: string }>,
  ): void {
    // Fire and forget — embedding failure should never affect conversation
    Promise.resolve().then(async () => {
      // Wait for memory encoder to finish storing (it's also async)
      await new Promise(r => setTimeout(r, 3000));

      for (const item of items) {
        if (item.text.length < 20) continue;
        try {
          const vec = await this.embedding.embed(item.text);
          if (!vec) continue;
          // Find the memory by source_message_id (direct lookup, no timing issues)
          const memory = this.store.findBySourceMessageId(agentId, item.messageId);
          if (memory) {
            this.store.updateEmbedding(memory.id, EmbeddingService.toBuffer(vec));
          }
        } catch (err) {
          console.warn('[MemoryEngine] Embedding generation failed:', err);
        }
      }
    }).catch(() => {}); // swallow all errors
  }

  /** Fallback when retrieval fails */
  fallback(): PromptFragment[] {
    return []; // graceful degradation: just skip memories
  }

  /** Get recent memories across all types (for CLI) */
  getRecentMemories(agentId: string, limit = 10): Memory[] {
    const types = ['episodic', 'semantic', 'stm', 'working', 'procedural'] as const;
    const all: Memory[] = [];
    for (const type of types) {
      all.push(...this.store.getRecent(agentId, type, limit));
    }
    return all
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /** Get memory type distribution stats (for admin panel) */
  getMemoryStats(agentId: string): Array<{ type: string; count: number }> {
    return this.store.getStats(agentId);
  }

  /** Get entity relations for graph visualization (for admin panel) */
  getEntityRelations(agentId: string, limit = 100): Array<{ source: string; relation: string; target: string; weight: number }> {
    return this.graphRag.getAllRelations(agentId, limit);
  }

  /** Get recent memories with optional type/search filtering (for admin panel) */
  getRecentMemoriesFiltered(agentId: string, limit = 50, type?: string, search?: string): Memory[] {
    return this.store.getRecentFiltered(agentId, limit, type, search);
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
export { EmbeddingService } from './embedding.js';
export { GraphRAG } from './graph-rag.js';
