import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  Engine, EngineContext, PromptFragment,
  BehavioralChange,
} from '../../types.js';
import type { IdentityEngine } from '../identity/index.js';
import type { AuditLog } from '../../security/audit.js';
import type { MetroidConfig } from '../../config.js';

// === Pattern detection rules ===

interface DetectedPattern {
  observation: string;
  adaptation: string;
  confidence: number;
}

const CORRECTION_MARKERS = [
  'no, i meant', 'not that', 'i said', 'what i mean is', 'actually,',
  'no no', 'wrong', 'that\'s not',
  '不是这个', '我说的是', '不对', '我的意思是', '搞错了',
];

const DETAIL_REQUEST_MARKERS = [
  'more detail', 'elaborate', 'explain more', 'tell me more', 'go on',
  'can you expand', 'what do you mean',
  '详细说说', '展开讲讲', '多说一点', '继续', '什么意思',
];

/**
 * Growth Engine: tracks behavioral adaptations over time.
 *
 * Only active in enhanced mode. Classic mode returns empty fragments.
 * Uses rule-based pattern detection (no LLM calls) to identify
 * recurring interaction patterns and propose behavioral adaptations.
 */
export class GrowthEngine implements Engine {
  readonly name = 'growth';

  private messageCounters = new Map<string, number>();
  private recentMessages = new Map<string, string[]>();

  constructor(
    private db: Database.Database,
    private identity: IdentityEngine,
    private audit: AuditLog,
    private config: MetroidConfig,
  ) {}

  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    if (context.mode === 'classic') return [];

    const changes = this.getActiveChanges(context.agentId);
    const qualified = changes.filter(c => c.confidence >= this.config.growth.minConfidence);
    if (qualified.length === 0) return [];

    const lines = qualified.map(c =>
      `- ${c.adaptation} (置信度: ${Math.round(c.confidence * 100)}%)`
    );
    const content = [
      '<behavioral_adaptations>',
      '基于过往互动，你已经做出以下调整：',
      ...lines,
      '</behavioral_adaptations>',
    ].join('\n');

    return [{
      source: 'growth',
      content,
      priority: 30,
      tokens: Math.ceil(content.length / 3),
      required: false,
    }];
  }

  async onResponse(response: string, context: EngineContext): Promise<void> {
    if (context.mode === 'classic') return;

    const agentId = context.agentId;
    const counter = (this.messageCounters.get(agentId) ?? 0) + 1;
    this.messageCounters.set(agentId, counter);

    // Accumulate recent user messages
    const recent = this.recentMessages.get(agentId) ?? [];
    recent.push(context.message.content);
    if (recent.length > this.config.growth.evaluationInterval * 2) {
      recent.splice(0, recent.length - this.config.growth.evaluationInterval);
    }
    this.recentMessages.set(agentId, recent);

    // Evaluate at interval
    if (counter >= this.config.growth.evaluationInterval) {
      this.messageCounters.set(agentId, 0);
      this.evaluateGrowth(agentId, recent);
    }
  }

  fallback(): PromptFragment[] {
    return [];
  }

  // === Public query methods ===

  getActiveChanges(agentId: string): BehavioralChange[] {
    const rows = this.db.prepare(
      'SELECT * FROM behavioral_changes WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC'
    ).all(agentId) as any[];
    return rows.map(this.rowToChange);
  }

  getAllChanges(agentId: string, limit = 50): BehavioralChange[] {
    const rows = this.db.prepare(
      'SELECT * FROM behavioral_changes WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentId, limit) as any[];
    return rows.map(this.rowToChange);
  }

  revertChange(changeId: string): void {
    this.db.prepare(
      'UPDATE behavioral_changes SET active = 0, reverted_at = datetime(?) WHERE id = ?'
    ).run(new Date().toISOString(), changeId);
  }

  // === Internal ===

  private evaluateGrowth(agentId: string, recentMessages: string[]): void {
    const agent = this.identity.getAgent(agentId);
    if (!agent?.card.growth?.enabled) return;

    // Check active changes cap
    const activeCount = this.db.prepare(
      'SELECT COUNT(*) as c FROM behavioral_changes WHERE agent_id = ? AND active = 1'
    ).get(agentId) as any;
    if (activeCount.c >= this.config.growth.maxActiveChanges) return;

    const patterns = this.detectPatterns(recentMessages);
    for (const pattern of patterns) {
      // Check if similar adaptation already exists
      const existing = this.db.prepare(
        'SELECT id FROM behavioral_changes WHERE agent_id = ? AND active = 1 AND adaptation = ?'
      ).get(agentId, pattern.adaptation) as any;
      if (existing) continue;

      // Check immutable values
      if (this.violatesImmutableValues(agent.card.soul?.immutableValues ?? [], pattern.adaptation)) {
        continue;
      }

      this.applyChange(agentId, pattern);
    }
  }

  detectPatterns(messages: string[]): DetectedPattern[] {
    if (messages.length < 3) return [];
    const patterns: DetectedPattern[] = [];
    const lowerMessages = messages.map(m => m.toLowerCase());

    // Pattern 1: User frequently corrects
    const corrections = lowerMessages.filter(m =>
      CORRECTION_MARKERS.some(marker => m.includes(marker))
    ).length;
    if (corrections >= 2) {
      patterns.push({
        observation: `用户在最近${messages.length}条消息中纠正了${corrections}次`,
        adaptation: '更注意用户的澄清，仔细理解用户的意图后再回复',
        confidence: Math.min(0.9, 0.4 + corrections * 0.15),
      });
    }

    // Pattern 2: Consistently short user replies (avg < 20 chars)
    const avgLength = messages.reduce((s, m) => s + m.length, 0) / messages.length;
    if (avgLength < 20 && messages.length >= 5) {
      patterns.push({
        observation: `用户平均消息长度仅${Math.round(avgLength)}字符`,
        adaptation: '保持回复简洁，避免过长的解释',
        confidence: 0.6,
      });
    }

    // Pattern 3: User frequently asks for more detail
    const detailRequests = lowerMessages.filter(m =>
      DETAIL_REQUEST_MARKERS.some(marker => m.includes(marker))
    ).length;
    if (detailRequests >= 2) {
      patterns.push({
        observation: `用户在最近${messages.length}条消息中${detailRequests}次要求更多细节`,
        adaptation: '提供更详细的解释和背景信息',
        confidence: Math.min(0.9, 0.4 + detailRequests * 0.15),
      });
    }

    // Pattern 4: Repeated topic keywords (frequency > 30%)
    const wordFreq = new Map<string, number>();
    for (const msg of lowerMessages) {
      const words = msg.split(/\s+/).filter(w => w.length > 3);
      const seen = new Set<string>();
      for (const w of words) {
        if (!seen.has(w)) { seen.add(w); wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1); }
      }
    }
    for (const [word, count] of wordFreq) {
      if (count / messages.length > 0.3 && count >= 3) {
        patterns.push({
          observation: `用户频繁提到"${word}"（${count}/${messages.length}条消息）`,
          adaptation: `用户对"${word}"相关话题感兴趣，可以主动展开相关讨论`,
          confidence: 0.5,
        });
        break; // Only one topic pattern per evaluation
      }
    }

    return patterns;
  }

  private applyChange(agentId: string, pattern: DetectedPattern): void {
    const id = randomUUID();
    this.db.prepare(
      'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(id, agentId, pattern.observation, pattern.adaptation, pattern.confidence);

    this.audit.log({
      timestamp: new Date(),
      actor: `agent:${agentId}`,
      action: 'growth.create',
      target: id,
      details: { observation: pattern.observation, adaptation: pattern.adaptation, confidence: pattern.confidence },
    });
  }

  private violatesImmutableValues(values: string[], adaptation: string): boolean {
    const lower = adaptation.toLowerCase();
    for (const value of values) {
      // Simple check: if adaptation contains negation of an immutable value
      if (lower.includes('不要') && lower.includes(value.toLowerCase())) return true;
      if (lower.includes('stop') && lower.includes(value.toLowerCase())) return true;
    }
    return false;
  }

  private rowToChange(row: any): BehavioralChange {
    return {
      id: row.id,
      agentId: row.agent_id,
      observation: row.observation,
      adaptation: row.adaptation,
      confidence: row.confidence,
      active: !!row.active,
      createdAt: new Date(row.created_at),
      revertedAt: row.reverted_at ? new Date(row.reverted_at) : undefined,
    };
  }
}
