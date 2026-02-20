import Anthropic from '@anthropic-ai/sdk';
import type { MetroidConfig } from '../../config.js';
import type { Memory, EmotionState } from '../../types.js';
import type { MemoryStore } from './store.js';
import type { AuditLog } from '../../security/audit.js';

/**
 * Async memory encoder:
 * - 100% storage: every message gets encoded into memory
 * - Recall is controlled by retriever (importance + relevance scoring)
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
   * Encode a message into memory. Returns immediately.
   * Actual encoding happens async in the background.
   * All messages are stored — recall probability is handled by the retriever.
   */
  encode(
    agentId: string,
    messageContent: string,
    messageId: string,
    emotionContext?: EmotionState,
  ): void {
    // Don't queue too many
    if (this.pendingCount > 10) return;

    this.pendingCount++;
    this.encodeAsync(agentId, messageContent, messageId, emotionContext)
      .catch(err => console.error('[MemoryEncoder] encoding failed:', err.message || err))
      .finally(() => this.pendingCount--);
  }

  private async encodeAsync(
    agentId: string,
    content: string,
    messageId: string,
    emotionContext?: EmotionState,
  ): Promise<void> {
    if (content.length < 20) return;

    // Short messages: skip LLM, use light encoding
    if (content.length < 50) {
      this.encodeLight(agentId, content, messageId, emotionContext);
      return;
    }

    try {
      let text: string;

      if (this.config.llm.openaiBaseUrl) {
        // OpenAI-compatible API
        const endpoint = this.config.llm.openaiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.llm.openaiApiKey || this.config.llm.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.llm.openaiModel || this.config.llm.lightModel,
            messages: [{ role: 'user', content: `Analyze this message and extract memorable information.
Return JSON with these fields:
- summary: one-sentence summary (required)
- keywords: array of 2-5 keywords (required)
- importance: 0.0-1.0 how important/memorable this is (required)
- type: "semantic" (fact/knowledge), "episodic" (event/experience), or "procedural" (behavior/habit)
- privacy: "public", "private", or "sensitive"

Message: "${content}"

Return ONLY valid JSON, no other text.` }],
            max_tokens: 500,
          }),
        });
        const result = await resp.json() as any;
        text = result.choices?.[0]?.message?.content || '';
      } else {
        // Anthropic Messages API
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
        const block = response.content[0];
        if (block.type !== 'text') {
          this.encodeLight(agentId, content, messageId, emotionContext);
          return;
        }
        text = block.text;
      }

      const parsed = this.parseJson(text);
      if (!parsed) {
        console.error('[MemoryEncoder] JSON parse failed, falling back to light encode');
        this.encodeLight(agentId, content, messageId, emotionContext);
        return;
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
    } catch (err: any) {
      console.error('[MemoryEncoder] LLM failed, falling back to light encode:', err.message || err);
      this.encodeLight(agentId, content, messageId, emotionContext);
    }
  }

  /** Light encoding: no LLM call, store raw content with basic keyword extraction */
  private encodeLight(
    agentId: string,
    content: string,
    messageId: string,
    emotionContext?: EmotionState,
  ): void {
    const keywords = this.extractBasicKeywords(content);
    this.store.create({
      agentId,
      type: 'stm',
      content,
      summary: content,
      importance: 0.3,
      confidence: 0.5,
      privacy: 'private',
      emotionContext,
      keywords,
      sourceMessageId: messageId,
      lastRecalledAt: undefined,
      fadedAt: undefined,
    });
  }

  /** Basic keyword extraction without LLM: CJK n-grams + English words */
  private extractBasicKeywords(text: string): string[] {
    const keywords: string[] = [];
    const english = text.match(/[a-zA-Z]{2,}/g) || [];
    keywords.push(...english.map(w => w.toLowerCase()));
    const cjk = text.replace(/[^\u4e00-\u9fff]/g, '');
    for (let n = 2; n <= Math.min(4, cjk.length); n++) {
      for (let i = 0; i <= cjk.length - n; i++) {
        keywords.push(cjk.slice(i, i + n));
      }
    }
    return [...new Set(keywords)].slice(0, 10);
  }

  /** Parse JSON from LLM response, handling markdown code blocks */
  private parseJson(raw: string): any | null {
    // Try direct parse first
    try {
      return JSON.parse(raw);
    } catch { /* fall through */ }

    // Try extracting from markdown code block
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch { /* fall through */ }
    }

    return null;
  }
}
