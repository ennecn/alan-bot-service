import type Database from 'better-sqlite3';
import type {
  Engine, EngineContext, PromptFragment,
  EmotionState, EmotionUpdate,
} from '../../types.js';
import type { IdentityEngine } from '../identity/index.js';
import type { AuditLog } from '../../security/audit.js';
import type { MetroidConfig } from '../../config.js';

// === Sentiment keyword lists (bilingual) ===

const POSITIVE_WORDS = [
  // English
  'love', 'great', 'amazing', 'wonderful', 'beautiful', 'awesome', 'fantastic',
  'happy', 'glad', 'thank', 'thanks', 'appreciate', 'perfect', 'excellent',
  'haha', 'hehe', 'lol', 'lmao', 'cute', 'sweet', 'kind', 'nice',
  'fun', 'enjoy', 'warm', 'comfort', 'smile', 'laugh', 'joy', 'hope',
  // Chinese
  '喜欢', '爱', '开心', '快乐', '高兴', '棒', '好棒', '太好了', '感谢', '谢谢',
  '哈哈', '嘻嘻', '可爱', '温柔', '甜', '赞', '厉害', '优秀', '完美',
  '不错', '好的', '好吧', '有趣', '好看', '漂亮', '舒服', '温暖', '陪',
  '一起', '逛逛', '珍惜', '回忆', '笑', '期待', '想念', '感动', '幸福',
];

const NEGATIVE_WORDS = [
  'hate', 'angry', 'annoyed', 'frustrated', 'terrible', 'awful', 'horrible',
  'sad', 'upset', 'disappointed', 'boring', 'stupid', 'useless', 'wrong',
  'ugh', 'sigh', 'damn', 'shit', 'lonely', 'regret', 'miss', 'lost', 'death',
  '讨厌', '烦', '生气', '愤怒', '难过', '伤心', '失望', '无聊', '糟糕',
  '唉', '哎', '烦死了', '受不了', '差劲', '垃圾',
  '短暂', '去世', '死', '离开', '遗憾', '后悔', '孤独', '寂寞', '悲伤',
  '流泪', '哭', '痛', '害怕', '担心', '不安', '迷茫',
];

const DOMINANCE_UP_WORDS = [
  'do this', 'you must', 'you should', 'tell me', 'explain', 'show me',
  'give me', 'i want', 'i need', 'now', 'immediately',
  '你必须', '你应该', '告诉我', '给我', '我要', '我需要', '马上', '立刻', '快',
];

const DOMINANCE_DOWN_WORDS = [
  'maybe', 'perhaps', 'i think', 'not sure', 'sorry', 'please', 'could you',
  'would you', 'if possible', 'i guess',
  '也许', '可能', '我觉得', '不确定', '对不起', '抱歉', '请', '能不能', '可以吗',
];

/**
 * Emotion Engine: PAD-model emotion tracking with LLM semantic analysis.
 *
 * Only active in enhanced mode. Classic mode returns empty fragments.
 * Uses LLM for semantic emotion analysis, with keyword/pattern matching as fallback.
 * Translates PAD state to indirect style hints in the prompt.
 */
export class EmotionEngine implements Engine {
  readonly name = 'emotion';

  private lastUpdateTime = new Map<string, number>();

  constructor(
    private db: Database.Database,
    private identity: IdentityEngine,
    private audit: AuditLog,
    private config: MetroidConfig,
  ) {}

  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    if (context.mode === 'classic') return [];

    const agent = this.identity.getAgent(context.agentId);
    if (!agent) return [];

    // Apply recovery (drift toward baseline)
    const baseline = agent.card.emotion?.baseline ?? { pleasure: 0, arousal: 0, dominance: 0 };
    const current = { ...agent.emotionState };
    const lastUpdate = this.lastUpdateTime.get(context.agentId) ?? Date.now();
    const elapsedHours = (Date.now() - lastUpdate) / 3_600_000;

    const recovered = this.applyRecovery(current, baseline, elapsedHours, agent.card.emotion?.resilience);
    if (recovered !== current) {
      this.persistState(context.agentId, recovered);
      agent.emotionState = recovered;
    }

    const intensityDial = (agent.card.emotion?.intensityDial ?? 0.8) * (agent.card.emotion?.expressiveness ?? 1.0);
    const hints = this.translateToStyleHints(recovered, intensityDial);
    if (!hints) return [];

    const content = `<emotion_context>\n${hints}\n</emotion_context>`;
    return [{
      source: 'emotion',
      content,
      priority: 40,
      tokens: Math.ceil(content.length / 3),
      required: false,
    }];
  }

  async onResponse(response: string, context: EngineContext): Promise<void> {
    if (context.mode === 'classic') return;

    const agent = this.identity.getAgent(context.agentId);
    if (!agent) return;

    // Check inertia
    const now = Date.now();
    const lastUpdate = this.lastUpdateTime.get(context.agentId) ?? 0;
    if (now - lastUpdate < this.config.emotion.minChangeInterval) return;

    // Try LLM semantic analysis first, fall back to keyword-based
    const historySlice = [...context.conversationHistory.slice(-2), { content: response }];
    let delta = await this.analyzeEmotionLLM(context.message.content, historySlice).catch(() => null);
    let source: 'llm' | 'keyword' = 'llm';

    if (!delta) {
      delta = this.analyzeEmotion(context.message.content, historySlice);
      source = 'keyword';
    }

    // Apply delta with clamping
    const intensityDial = agent.card.emotion?.intensityDial ?? 0.8;
    const newState = this.applyDelta(agent.emotionState, delta, intensityDial);

    // Persist
    agent.emotionState = newState;
    this.persistState(context.agentId, newState);
    this.lastUpdateTime.set(context.agentId, now);

    await this.audit.log({
      timestamp: new Date(),
      actor: `agent:${context.agentId}`,
      action: 'emotion.update',
      target: context.agentId,
      details: { delta, newState, source },
    });
  }

  fallback(): PromptFragment[] {
    return [];
  }

  /** Get current emotion state for an agent */
  getState(agentId: string): EmotionState | undefined {
    return this.identity.getAgent(agentId)?.emotionState;
  }

  // === Internal methods (exposed as package-private for testing) ===

  analyzeEmotion(text: string, history: { content: string }[]): EmotionState {
    const scanText = [text, ...history.map(h => h.content)].join(' ').toLowerCase();

    let pleasure = 0;
    let arousal = 0;
    let dominance = 0;

    // Pleasure: positive vs negative words
    const posCount = POSITIVE_WORDS.filter(w => scanText.includes(w)).length;
    const negCount = NEGATIVE_WORDS.filter(w => scanText.includes(w)).length;
    pleasure = Math.min(0.3, posCount * 0.08) - Math.min(0.3, negCount * 0.08);

    // Arousal: exclamation marks, caps ratio, question density
    const exclamations = (text.match(/[!！]/g) || []).length;
    const capsRatio = text.length > 10
      ? (text.match(/[A-Z]/g) || []).length / text.length
      : 0;
    arousal = Math.min(0.3, exclamations * 0.06 + capsRatio * 0.5);

    // Dominance: command words vs uncertain words
    const domUp = DOMINANCE_UP_WORDS.filter(w => scanText.includes(w)).length;
    const domDown = DOMINANCE_DOWN_WORDS.filter(w => scanText.includes(w)).length;
    dominance = Math.min(0.2, domUp * 0.06) - Math.min(0.2, domDown * 0.06);

    return { pleasure, arousal, dominance };
  }

  applyDelta(current: EmotionState, delta: EmotionState, intensityDial: number): EmotionState {
    const max = this.config.emotion.maxChangePerUpdate;
    const clampDelta = (v: number) => Math.max(-max, Math.min(max, v * intensityDial));

    return {
      pleasure: this.clampPAD(current.pleasure + clampDelta(delta.pleasure)),
      arousal: this.clampPAD(current.arousal + clampDelta(delta.arousal)),
      dominance: this.clampPAD(current.dominance + clampDelta(delta.dominance)),
    };
  }

  applyRecovery(current: EmotionState, baseline: EmotionState, elapsedHours: number, resilience?: number): EmotionState {
    if (elapsedHours <= 0) return current;
    // resilience scales recovery: 0 = very slow (0.2×), 1 = full speed (1×)
    const resilienceFactor = 0.2 + 0.8 * (resilience ?? 0.5);
    const rate = this.config.emotion.recoveryRate * resilienceFactor * elapsedHours;

    const drift = (cur: number, base: number) => {
      if (Math.abs(cur - base) < 0.01) return base;
      const direction = base > cur ? 1 : -1;
      const moved = cur + direction * Math.min(rate, Math.abs(cur - base));
      return moved;
    };

    return {
      pleasure: drift(current.pleasure, baseline.pleasure),
      arousal: drift(current.arousal, baseline.arousal),
      dominance: drift(current.dominance, baseline.dominance),
    };
  }

  translateToStyleHints(state: EmotionState, intensityDial: number): string {
    if (intensityDial < 0.1) return '';

    const threshold = 0.15;
    const p = state.pleasure, a = state.arousal, d = state.dominance;

    // Skip if all dimensions are below threshold (neutral state)
    if (Math.abs(p) < threshold && Math.abs(a) < threshold && Math.abs(d) < threshold) return '';

    // Describe emotional state, not prescribe behavior
    const desc: string[] = [];
    if (Math.abs(p) >= threshold) desc.push(`愉悦度: ${p > 0 ? '正面' : '负面'} (${p.toFixed(2)})`);
    if (Math.abs(a) >= threshold) desc.push(`激活度: ${a > 0 ? '高' : '低'} (${a.toFixed(2)})`);
    if (Math.abs(d) >= threshold) desc.push(`支配感: ${d > 0 ? '强' : '弱'} (${d.toFixed(2)})`);

    return [
      `角色当前内心情绪: ${desc.join(', ')}`,
      '请根据角色人设自然地表达这种情绪状态，不要偏离角色性格。',
    ].join('\n');
  }

  // === LLM semantic analysis ===

  private async analyzeEmotionLLM(
    text: string,
    history: { content: string }[],
  ): Promise<EmotionState | null> {
    const baseUrl = this.config.llm.openaiBaseUrl;
    const apiKey = this.config.llm.openaiApiKey || this.config.llm.apiKey;
    if (!baseUrl || !apiKey) return null;

    const snippet = [text, ...history.map(h => h.content)].join('\n').slice(0, 800);
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
          content: `分析以下对话片段的情感变化，返回PAD情感模型的变化量（delta）。

PAD模型说明：
- pleasure（愉悦度）：-0.3 ~ +0.3，正值=开心/满足，负值=不快/沮丧
- arousal（激活度）：-0.3 ~ +0.3，正值=兴奋/激动，负值=平静/低落
- dominance（支配度）：-0.2 ~ +0.2，正值=用户主导/命令式，负值=用户谦逊/请求式

注意：
- 分析的是用户消息传达的情感倾向，不是AI回复的情感
- 数值应反映情感强度，日常对话通常在±0.1以内
- 中性对话返回接近0的值

对话内容：
"""
${snippet}
"""

仅返回JSON，格式：{"pleasure": 0.0, "arousal": 0.0, "dominance": 0.0}`,
        }],
        max_tokens: 100,
      }),
    });

    if (!resp.ok) return null;
    const result = await resp.json() as any;
    const raw = result.choices?.[0]?.message?.content || '';
    return this.parsePADJson(raw);
  }

  private parsePADJson(raw: string): EmotionState | null {
    const text = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(text);
      if (
        typeof parsed.pleasure === 'number' &&
        typeof parsed.arousal === 'number' &&
        typeof parsed.dominance === 'number'
      ) {
        return {
          pleasure: Math.max(-0.3, Math.min(0.3, parsed.pleasure)),
          arousal: Math.max(-0.3, Math.min(0.3, parsed.arousal)),
          dominance: Math.max(-0.2, Math.min(0.2, parsed.dominance)),
        };
      }
    } catch { /* fall through */ }
    return null;
  }

  private clampPAD(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }

  private persistState(agentId: string, state: EmotionState): void {
    this.db.prepare(
      'UPDATE agents SET emotion_state = ?, updated_at = datetime(?) WHERE id = ?'
    ).run(JSON.stringify(state), new Date().toISOString(), agentId);
  }

  /** V8: External emotion nudge (from social events, etc.) */
  nudge(agentId: string, delta: Partial<EmotionState>, source: string): void {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return;

    const intensityDial = agent.card.emotion?.intensityDial ?? 0.8;
    const fullDelta: EmotionState = {
      pleasure: delta.pleasure ?? 0,
      arousal: delta.arousal ?? 0,
      dominance: delta.dominance ?? 0,
    };

    const newState = this.applyDelta(agent.emotionState, fullDelta, intensityDial);
    agent.emotionState = newState;
    this.persistState(agentId, newState);
  }
}
