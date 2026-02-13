import Anthropic from '@anthropic-ai/sdk';
import type { MetroidConfig } from '../../config.js';
import type { Memory, EmotionState } from '../../types.js';
import type { MemoryStore } from './store.js';
import type { AuditLog } from '../../security/audit.js';

/**
 * Async memory encoder (from 阿澪's feedback):
 * - 30% sampling: not every message gets encoded
 * - Uses lightweight model (Haiku) for extraction
 * - Non-blocking: encoding failure doesn't affect conversation
 */
export class MemoryEncoder {
  private client: Anthropic;
  private pendingCount = 0;

  constructor(
    private store: MemoryStore,
    private audit: AuditLog,
    private config: MetroidConfig,
  ) {
    this.client = new Anthropic({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
    });
  }

  /**
   * Maybe encode a message into memory. Returns immediately.
   * Actual encoding happens async in the background.
   */
  maybeEncode(
    agentId: string,
    messageContent: string,
    messageId: string,
    emotionContext?: EmotionState,
  ): void {
    // Sampling: only encode ~30% of messages
    if (Math.random() > this.config.memory.encodingSampleRate) return;

    // Don't queue too many
    if (this.pendingCount > 10) return;

    this.pendingCount++;
    this.encodeAsync(agentId, messageContent, messageId, emotionContext)
      .catch(err => console.error('[MemoryEncoder] encoding failed:', err))
      .finally(() => this.pendingCount--);
  }

  private async encodeAsync(
    agentId: string,
    content: string,
    messageId: string,
    emotionContext?: EmotionState,
  ): Promise<void> {
    if (content.length < 20) return;

    const response = await this.client.messages.create({
      model: this.config.llm.lightModel,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analyze this message and extract memorable information.
Return JSON with these fields:
- summary: one-sentence summary (required)
- keywords: array of 2-5 keywords (required)
- importance: 0.0-1.0 how important/memorable this is (required)
- type: "semantic" (fact/knowledge), "episodic" (event/experience), or "procedural" (behavior/habit)
- privacy: "public", "private", or "sensitive"

Message: "${content}"

Return ONLY valid JSON, no other text.`,
      }],
    });

    const text = response.content[0];
    if (text.type !== 'text') return;

    let parsed: any;
    try {
      parsed = JSON.parse(text.text);
    } catch {
      return; // silently skip malformed responses
    }

    const memory = this.store.create({
      agentId,
      type: parsed.type || 'semantic',
      content,
      summary: parsed.summary,
      importance: Math.min(1, Math.max(0, parsed.importance ?? 0.5)),
      confidence: 0.7,
      privacy: parsed.privacy || 'private',
      emotionContext,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      sourceMessageId: messageId,
      lastRecalledAt: undefined,
      fadedAt: undefined,
    });

    await this.audit.log({
      timestamp: new Date(),
      actor: `agent:${agentId}`,
      action: 'memory.create',
      target: memory.id,
      details: { summary: parsed.summary, importance: memory.importance },
    });
  }
}