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
  // Chinese
  '喜欢', '爱', '开心', '快乐', '高兴', '棒', '好棒', '太好了', '感谢', '谢谢',
  '哈哈', '嘻嘻', '可爱', '温柔', '甜', '赞', '厉害', '优秀', '完美',
];

const NEGATIVE_WORDS = [
  'hate', 'angry', 'annoyed', 'frustrated', 'terrible', 'awful', 'horrible',
  'sad', 'upset', 'disappointed', 'boring', 'stupid', 'useless', 'wrong',
  'ugh', 'sigh', 'damn', 'shit',
  '讨厌', '烦', '生气', '愤怒', '难过', '伤心', '失望', '无聊', '糟糕',
  '唉', '哎', '烦死了', '受不了', '差劲', '垃圾',
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
 * Emotion Engine: PAD-model emotion tracking with rule-based analysis.
 *
 * Only active in enhanced mode. Classic mode returns empty fragments.
 * Uses keyword/pattern matching (no LLM calls) to detect sentiment shifts.
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

    const recovered = this.applyRecovery(current, baseline, elapsedHours);
    if (recovered !== current) {
      this.persistState(context.agentId, recovered);
      agent.emotionState = recovered;
    }

    const intensityDial = agent.card.emotion?.intensityDial ?? 0.5;
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

    // Analyze emotion from user message + recent history
    const delta = this.analyzeEmotion(
      context.message.content,
      context.conversationHistory.slice(-2),
    );

    // Apply delta with clamping
    const intensityDial = agent.card.emotion?.intensityDial ?? 0.5;
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
      details: { delta, newState },
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

  applyRecovery(current: EmotionState, baseline: EmotionState, elapsedHours: number): EmotionState {
    if (elapsedHours <= 0) return current;
    const rate = this.config.emotion.recoveryRate * elapsedHours;

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
    const hints: string[] = [];
    const threshold = 0.15; // minimum deviation to generate a hint

    // Pleasure + Arousal combinations
    if (state.pleasure > threshold && state.arousal > threshold) {
      hints.push('回复时可以更活泼一些，多用语气词和表情。');
    } else if (state.pleasure > threshold && state.arousal <= threshold) {
      hints.push('回复时保持温和友好的语气。');
    } else if (state.pleasure < -threshold && state.arousal > threshold) {
      hints.push('回复时可以更直接一些，不需要过多修饰。');
    } else if (state.pleasure < -threshold && state.arousal <= -threshold) {
      hints.push('回复时简短一些，语气平淡。');
    }

    // Dominance
    if (state.dominance > threshold) {
      hints.push('可以更自信地表达观点。');
    } else if (state.dominance < -threshold) {
      hints.push('语气可以更柔和、谦逊一些。');
    }

    // Scale by intensity dial
    if (hints.length === 0 || intensityDial < 0.1) return '';
    return hints.join('\n');
  }

  private clampPAD(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }

  private persistState(agentId: string, state: EmotionState): void {
    this.db.prepare(
      'UPDATE agents SET emotion_state = ?, updated_at = datetime(?) WHERE id = ?'
    ).run(JSON.stringify(state), new Date().toISOString(), agentId);
  }
}
