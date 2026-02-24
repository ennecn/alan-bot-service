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
 * Uses LLM deep pattern detection with rule-based fallback to identify
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
      try {
        await this.evaluateGrowth(agentId, recent);
      } catch (err: any) {
        console.error('[GrowthEngine] evaluation failed:', err.message || err);
      }
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

  /** Decay confidence of behavioral changes that haven't been reinforced recently */
  private applyConfidenceDecay(agentId: string): void {
    const graceDays = this.config.growth.confidenceDecayGraceDays;
    const decayRate = this.config.growth.confidenceDecayRate;
    const minConf = this.config.growth.minConfidence;
    const now = new Date();

    const rows = this.db.prepare(
      'SELECT id, confidence, last_reinforced_at, created_at FROM behavioral_changes WHERE agent_id = ? AND active = 1'
    ).all(agentId) as any[];

    for (const row of rows) {
      const reinforcedAt = new Date(row.last_reinforced_at || row.created_at);
      const daysSinceReinforced = (now.getTime() - reinforcedAt.getTime()) / 86_400_000;
      if (daysSinceReinforced <= graceDays) continue;

      const daysPastGrace = daysSinceReinforced - graceDays;
      const newConf = row.confidence - decayRate * daysPastGrace;

      if (newConf < minConf) {
        // Deactivate — confidence too low
        this.db.prepare(
          'UPDATE behavioral_changes SET active = 0, confidence = ?, reverted_at = datetime(?) WHERE id = ?'
        ).run(Math.max(0, newConf), now.toISOString(), row.id);
      } else {
        this.db.prepare(
          'UPDATE behavioral_changes SET confidence = ? WHERE id = ?'
        ).run(newConf, row.id);
      }
    }
  }

  private async evaluateGrowth(agentId: string, recentMessages: string[]): Promise<void> {
    const agent = this.identity.getAgent(agentId);
    if (!agent?.card.growth?.enabled) return;

    // Apply confidence decay before evaluation
    this.applyConfidenceDecay(agentId);

    // Check active changes cap
    const activeCount = this.db.prepare(
      'SELECT COUNT(*) as c FROM behavioral_changes WHERE agent_id = ? AND active = 1'
    ).get(agentId) as any;
    if (activeCount.c >= this.config.growth.maxActiveChanges) return;

    // Try LLM analysis first, fall back to rule-based
    let patterns = await this.detectPatternsLLM(recentMessages).catch(() => null);
    if (!patterns) {
      patterns = this.detectPatterns(recentMessages);
    }

    for (const pattern of patterns) {
      // Check if similar adaptation already exists — reinforce if so
      const existing = this.db.prepare(
        'SELECT id, confidence FROM behavioral_changes WHERE agent_id = ? AND active = 1 AND adaptation = ?'
      ).get(agentId, pattern.adaptation) as any;
      if (existing) {
        const newConf = Math.min(1.0, existing.confidence + 0.05);
        this.db.prepare(
          'UPDATE behavioral_changes SET confidence = ?, last_reinforced_at = datetime(?) WHERE id = ?'
        ).run(newConf, new Date().toISOString(), existing.id);
        continue;
      }

      // Check immutable values
      if (this.violatesImmutableValues(agent.card.soul?.immutableValues ?? [], pattern.adaptation)) {
        continue;
      }

      this.applyChange(agentId, pattern);
    }

    // Sync high-confidence behavioral changes to identity traits
    this.syncToIdentity(agentId);
  }

  /**
   * Sync high-confidence behavioral changes to Identity mutable traits.
   * When a behavioral adaptation has confidence >= 0.8, derive a personality
   * trait and update the Identity engine.
   */
  private syncToIdentity(agentId: string): void {
    const changes = this.getActiveChanges(agentId);
    const highConfidence = changes.filter(c => c.confidence >= 0.8);

    for (const change of highConfidence) {
      const trait = this.adaptationToTrait(change.adaptation);
      if (trait) {
        this.identity.updateTrait(agentId, trait.name, trait.delta);
      }
    }
  }

  /** Map a behavioral adaptation to a personality trait adjustment */
  private adaptationToTrait(adaptation: string): { name: string; delta: number } | null {
    const lower = adaptation.toLowerCase();

    if (lower.includes('简洁') || lower.includes('concise') || lower.includes('shorter')) {
      return { name: '简洁', delta: 0.1 };
    }
    if (lower.includes('详细') || lower.includes('detail') || lower.includes('elaborate')) {
      return { name: '详细', delta: 0.1 };
    }
    if (lower.includes('澄清') || lower.includes('理解') || lower.includes('意图') || lower.includes('careful')) {
      return { name: '细心', delta: 0.1 };
    }
    if (lower.includes('好奇') || lower.includes('延伸') || lower.includes('背景') || lower.includes('curious')) {
      return { name: '好奇心引导', delta: 0.1 };
    }
    if (lower.includes('感兴趣') || lower.includes('主动展开') || lower.includes('interest')) {
      return { name: '话题敏感', delta: 0.05 };
    }

    return null;
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

    // Pattern 2: Consistently short user replies (avg < 10 chars for CJK, < 20 for Latin)
    const avgLength = messages.reduce((s, m) => s + m.length, 0) / messages.length;
    const hasCJK = messages.some(m => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(m));
    const shortThreshold = hasCJK ? 10 : 20;
    if (avgLength < shortThreshold && messages.length >= 5) {
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
      // Split on whitespace for Latin, extract 2-4 char CJK segments for Chinese
      const latinWords = msg.split(/\s+/).filter(w => w.length > 3 && !/[\u4e00-\u9fff]/.test(w));
      const cjkMatches = msg.match(/[\u4e00-\u9fff]{2,4}/g) || [];
      const words = [...latinWords, ...cjkMatches];
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

    // Pattern 5: User frequently asks questions (curious user)
    const questions = lowerMessages.filter(m =>
      m.includes('?') || m.includes('？') || m.includes('吗') || m.includes('呢') ||
      m.includes('为什么') || m.includes('怎么') || m.includes('什么') || m.includes('哪')
    ).length;
    if (questions >= Math.ceil(messages.length * 0.5) && messages.length >= 5) {
      patterns.push({
        observation: `用户在最近${messages.length}条消息中有${questions}条是提问`,
        adaptation: '用户好奇心强，回复时可以主动补充相关背景和延伸信息',
        confidence: 0.55,
      });
    }

    return patterns;
  }

  // === LLM deep pattern detection ===

  private async detectPatternsLLM(messages: string[]): Promise<DetectedPattern[] | null> {
    const baseUrl = this.config.llm.openaiBaseUrl;
    const apiKey = this.config.llm.openaiApiKey || this.config.llm.apiKey;
    if (!baseUrl || !apiKey) return null;

    const snippet = messages.slice(-15).map((m, i) => `[${i + 1}] ${m}`).join('\n').slice(0, 1500);
    const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llm.openaiModel || this.config.llm.lightModel,
        messages: [{
          role: 'user',
          content: `分析以下用户消息序列，识别用户的行为模式和交互偏好。

用户最近的消息：
"""
${snippet}
"""

请识别用户的交互模式，例如：
- 沟通风格偏好（简洁/详细、正式/随意）
- 反复出现的需求或兴趣话题
- 对AI回复的隐含反馈（频繁纠正、要求展开、表示无聊等）
- 情感表达习惯
- 提问方式和好奇心方向

返回JSON数组，每个元素包含：
- observation: 观察到的具体模式（用中文描述，引用具体证据）
- adaptation: 建议的行为调整（用中文，简洁可执行的指令）
- confidence: 置信度 0.0-1.0

规则：
- 最多返回3个最显著的模式
- confidence低于0.4的不要返回
- adaptation应该是具体的行为指令，不是笼统的建议
- 如果没有明显模式，返回空数组 []

仅返回JSON数组，无其他文字。`,
        }],
        max_tokens: 500,
      }),
    });

    if (!resp.ok) return null;
    const result = await resp.json() as any;
    const raw = result.choices?.[0]?.message?.content || '';
    return this.parsePatternsJson(raw);
  }

  private parsePatternsJson(raw: string): DetectedPattern[] | null {
    const text = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed
        .filter((p: any) =>
          typeof p.observation === 'string' &&
          typeof p.adaptation === 'string' &&
          typeof p.confidence === 'number' &&
          p.confidence >= 0.4
        )
        .map((p: any) => ({
          observation: p.observation.slice(0, 200),
          adaptation: p.adaptation.slice(0, 100),
          confidence: Math.min(1, Math.max(0, p.confidence)),
        }))
        .slice(0, 3);
    } catch {
      return null;
    }
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
      const v = value.toLowerCase();
      // Direct negation of immutable value
      if (lower.includes('不要') && lower.includes(v)) return true;
      if (lower.includes('stop') && lower.includes(v)) return true;
      if (lower.includes('不再') && lower.includes(v)) return true;
      if (lower.includes('避免') && lower.includes(v)) return true;
    }

    // Block generic style overrides that conflict with any personality
    const styleOverrides = [
      '多用语气词', '多用表情', '多用emoji', '更活泼', '更可爱',
      '更冷淡', '更高冷', '更温柔', '更强势', '更卑微',
      'use more emoji', 'be more cute', 'be more cold',
    ];
    if (styleOverrides.some(s => lower.includes(s))) return true;

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
      lastReinforcedAt: row.last_reinforced_at ? new Date(row.last_reinforced_at) : undefined,
    };
  }
}
