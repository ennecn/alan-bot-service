/**
 * Emotion Narrativizer — Converts EmotionState into natural language.
 * PRD v6.0 §3.1.2
 */

import type { EmotionDimension, EmotionState } from '../types/index.js';

type Intensity = 'mild' | 'moderate' | 'strong' | 'extreme';
type Language = 'zh' | 'en' | 'ja';
type Templates = Record<EmotionDimension, Record<Intensity, string>>;

const TEMPLATES: Record<Language, Templates> = {
  en: {
    joy:      { mild: 'a faint warmth',        moderate: 'a quiet happiness',       strong: 'genuine joy',              extreme: 'overwhelming elation' },
    sadness:  { mild: 'a slight melancholy',    moderate: 'a lingering sadness',     strong: 'deep sorrow',              extreme: 'crushing grief' },
    anger:    { mild: 'a flicker of irritation', moderate: 'simmering frustration',  strong: 'burning anger',            extreme: 'uncontainable fury' },
    anxiety:  { mild: 'a hint of unease',       moderate: 'growing worry',           strong: 'intense anxiety',          extreme: 'paralyzing dread' },
    longing:  { mild: 'a passing thought',      moderate: 'a quiet longing',         strong: 'deep yearning',            extreme: 'aching desire' },
    trust:    { mild: 'cautious openness',      moderate: 'steady trust',            strong: 'deep confidence',          extreme: 'absolute devotion' },
  },
  zh: {
    joy:      { mild: '淡淡的温暖',     moderate: '安静的喜悦',     strong: '由衷的快乐',     extreme: '难以抑制的狂喜' },
    sadness:  { mild: '一丝忧郁',       moderate: '挥之不去的悲伤', strong: '深深的哀愁',     extreme: '令人窒息的悲痛' },
    anger:    { mild: '些许烦躁',       moderate: '压抑的不满',     strong: '灼热的愤怒',     extreme: '无法遏制的暴怒' },
    anxiety:  { mild: '隐约的不安',     moderate: '渐增的担忧',     strong: '强烈的焦虑',     extreme: '令人瘫痪的恐惧' },
    longing:  { mild: '一闪而过的念想', moderate: '安静的思念',     strong: '深切的渴望',     extreme: '刻骨的想念' },
    trust:    { mild: '谨慎的开放',     moderate: '稳定的信任',     strong: '深厚的信赖',     extreme: '绝对的忠诚' },
  },
  ja: {
    joy:      { mild: 'ほのかな温もり',     moderate: '静かな喜び',       strong: '心からの幸福',     extreme: '抑えきれない歓喜' },
    sadness:  { mild: 'わずかな憂い',       moderate: '消えない悲しみ',   strong: '深い哀しみ',       extreme: '息が詰まるほどの悲痛' },
    anger:    { mild: 'かすかな苛立ち',     moderate: 'くすぶる不満',     strong: '燃える怒り',       extreme: '抑えられない激怒' },
    anxiety:  { mild: 'ほんの少しの不安',   moderate: '募る心配',         strong: '強い不安',         extreme: '身動きできない恐怖' },
    longing:  { mild: 'ふと過ぎる想い',     moderate: '静かな恋しさ',     strong: '深い渇望',         extreme: '胸が張り裂ける想い' },
    trust:    { mild: '慎重な心の開き',     moderate: '安定した信頼',     strong: '深い信頼',         extreme: '絶対的な献身' },
  },
};

function getIntensity(value: number): Intensity | null {
  if (value < 0.2) return null;
  if (value < 0.4) return 'mild';
  if (value < 0.6) return 'moderate';
  if (value < 0.8) return 'strong';
  return 'extreme';
}

const DIMENSIONS: EmotionDimension[] = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'];

/**
 * Convert an EmotionState into a natural language paragraph.
 * Dimensions with value < 0.2 are skipped.
 */
export function narrativize(
  state: EmotionState,
  language: Language,
  customTemplates?: Partial<Record<EmotionDimension, Record<string, string>>>,
): string {
  const builtIn = TEMPLATES[language];
  const fragments: string[] = [];

  for (const d of DIMENSIONS) {
    const intensity = getIntensity(state[d]);
    if (!intensity) continue;

    const custom = customTemplates?.[d]?.[intensity];
    const text = custom ?? builtIn[d][intensity];
    fragments.push(text);
  }

  if (fragments.length === 0) {
    return language === 'zh' ? '内心平静。'
         : language === 'ja' ? '心は穏やかだ。'
         : 'A calm, neutral state.';
  }

  // Join fragments into a sentence
  if (language === 'zh') return `感受到${fragments.join('、')}。`;
  if (language === 'ja') return `${fragments.join('、')}を感じている。`;
  return `Feeling ${fragments.join(', ')}.`;
}

// ============================================================
// Writing Directive — PRD v4.0 §2.1.5
// ============================================================

export interface WriteDirectiveOptions {
  state: EmotionState;
  language: Language;
  suppressionCount?: number;
  lastSuppressTime?: string | null;
  directiveHistory?: string[];
  sessionTimeoutHours?: number;
}

interface DirectiveResult {
  directive: string;
  patternId: string;
  debug?: {
    guard_fired: string | null;
    candidates: string[];
    tie_break: string | null;
    variant_index: number;
    suppression_skipped: boolean;
  };
}

type PatternId =
  | 'sadness' | 'joy' | 'anger' | 'anxiety' | 'longing'
  | 'intimate_trust' | 'mixed_conflict' | 'calm' | 'suppression';

const DIRECTIVE_TEMPLATES: Record<PatternId, Record<Language, string[]>> = {
  sadness: {
    zh: [
      '用留白和省略传达沉重感。句子要短，节奏要慢。让沉默比语言更有力。',
      '让环境承载角色无法说出的感受。天气、光线、声音都可以代替语言。',
    ],
    en: [
      'Use whitespace and omission. Short sentences, slow rhythm. Let silence speak louder than words.',
      'Let the environment carry what the character cannot say. Weather, light, sound can replace words.',
    ],
    ja: [
      '余白と省略で重さを伝える。文は短く、リズムは遅く。沈黙に語らせる。',
      '環境にキャラクターが言えないことを語らせる。天気、光、音が言葉の代わりになる。',
    ],
  },
  joy: {
    zh: [
      '用流动的感官细节和明快的节奏传达愉悦。让环境也跟着角色一起亮起来。',
      '用动作和对话的节奏感传达轻快。让角色的身体语言比台词更诚实。',
    ],
    en: [
      'Flowing sensory detail, brisk rhythm. Let the environment brighten with the character.',
      'Use the rhythm of actions and dialogue to convey lightness. Let body language be more honest than lines.',
    ],
    ja: [
      '流れるような感覚描写と軽快なリズムで喜びを伝える。環境もキャラクターと一緒に輝かせる。',
      '動作と対話のリズムで軽やかさを伝える。身体の言葉を台詞より正直にする。',
    ],
  },
  anger: {
    zh: [
      '用短促、有力的句子。动作描写优先于心理描写。克制比爆发更有张力。',
      '用环境中的硬物和尖锐声音映射角色的内在状态。不要让角色解释自己为什么生气。',
    ],
    en: [
      'Short, forceful sentences. Action over introspection. Restraint is more powerful than outburst.',
      'Use hard objects and sharp sounds in the environment to mirror the character\'s inner state. Don\'t let the character explain why they\'re angry.',
    ],
    ja: [
      '短く力強い文。動作を心理より優先。爆発より抑制に張力がある。',
      '環境の硬い物や鋭い音でキャラクターの内面を映す。怒りの理由を説明させない。',
    ],
  },
  anxiety: {
    zh: [
      '用碎片化的思维和敏锐的感官捕捉不安感。注意力在细节间快速跳跃。',
      '让角色注意到平时不会注意的细节——门锁的方向、窗帘的缝隙、远处的脚步声。',
    ],
    en: [
      'Fragmented thoughts, sharp sensory awareness. Attention jumps rapidly between details.',
      'Make the character notice details they normally wouldn\'t — the direction of a lock, a gap in curtains, distant footsteps.',
    ],
    ja: [
      '断片的な思考と鋭い感覚で不安を捉える。注意は細部の間を素早く跳ぶ。',
      'キャラクターに普段気にしないディテールを気づかせる——鍵の向き、カーテンの隙間、遠くの足音。',
    ],
  },
  longing: {
    zh: [
      '用回忆与现实的交错营造距离感。感官记忆比直白的思念更有力。',
      '让角色碰到一个具体的旧物——气味、歌、或者某个路口——然后用现实的落差代替\'我想你\'。',
    ],
    en: [
      'Interleave memory with present reality. Sensory memory is stronger than stated longing.',
      'Have the character encounter a specific old object — a smell, a song, a street corner — then use the gap between past and present instead of \'I miss you.\'',
    ],
    ja: [
      '記憶と現実を交錯させて距離感を演出。感覚の記憶は直接的な恋しさより力強い。',
      'キャラクターに具体的な古い物——匂い、歌、ある交差点——に触れさせ、「会いたい」の代わりに過去と現在の落差を使う。',
    ],
  },
  intimate_trust: {
    zh: [
      '语言松弛自然。对话多于描写。用小动作和口头禅传达亲近感。',
      '让角色说不完整的句子、用昵称、分享无意义的小事。亲密感在废话里。',
    ],
    en: [
      'Relaxed, natural language. More dialogue than description. Small gestures and verbal habits convey closeness.',
      'Let the character speak in incomplete sentences, use nicknames, share meaningless small things. Intimacy lives in idle talk.',
    ],
    ja: [
      '言葉はリラックスして自然に。描写より対話を多く。小さな仕草と口癖で親密さを伝える。',
      'キャラクターに不完全な文、あだ名、意味のない小さなことを共有させる。親密さは無駄話の中にある。',
    ],
  },
  mixed_conflict: {
    zh: [
      '用潜台词和反差。角色说的和想的不一样。用动作泄露真实情绪。',
      '让角色做一件和说的话矛盾的事——比如说\'没事\'的时候把杯子握得更紧。',
    ],
    en: [
      'Use subtext and contrast. What the character says differs from what they think. Actions betray real feelings.',
      'Have the character do something that contradicts what they said — like gripping a cup tighter while saying \'I\'m fine.\'',
    ],
    ja: [
      'サブテキストとコントラストを使う。言葉と本音を違えさせる。動作が本当の感情を漏らす。',
      'キャラクターに言葉と矛盾する行動をさせる——「大丈夫」と言いながらカップを強く握るように。',
    ],
  },
  calm: {
    zh: [
      '平实自然。让对话推动场景，不要刻意制造戏剧性。',
      '写日常的质感——茶的温度、窗外的声音、手边的小物件。让平静本身成为画面。',
    ],
    en: [
      'Plain and natural. Let dialogue drive the scene. Don\'t manufacture drama.',
      'Write the texture of daily life — the temperature of tea, sounds outside the window, small objects at hand. Let calm itself become the scene.',
    ],
    ja: [
      '平実で自然に。対話でシーンを動かす。無理にドラマを作らない。',
      '日常の質感を書く——お茶の温度、窓の外の音、手元の小物。静けさそのものをシーンにする。',
    ],
  },
  suppression: {
    zh: [
      '写克制。情绪通过身体细节（手指、呼吸、视线）而不是内心独白泄露。',
      '让角色的手在做一件事，嘴在说另一件事。身体比语言更诚实。',
    ],
    en: [
      'Write restraint. Emotions leak through body details (fingers, breathing, gaze), not inner monologue.',
      'Let the character\'s hands do one thing while their mouth says another. The body is more honest than words.',
    ],
    ja: [
      '抑制を書く。感情は身体の細部（指、呼吸、視線）から漏れる。内面の独白ではなく。',
      'キャラクターの手に一つのことをさせ、口には別のことを言わせる。身体は言葉より正直だ。',
    ],
  },
};

/** Tie-break priority: sadness > anger > anxiety > longing > joy > trust */
const TIE_BREAK_PRIORITY: EmotionDimension[] = ['sadness', 'anger', 'anxiety', 'longing', 'joy', 'trust'];

export function writeDirective(opts: WriteDirectiveOptions): DirectiveResult {
  const { state, language, directiveHistory = [] } = opts;
  const suppressionCount = opts.suppressionCount ?? 0;
  const lastSuppressTime = opts.lastSuppressTime ?? null;
  const sessionTimeoutHours = opts.sessionTimeoutHours ?? 4;

  const debug = {
    guard_fired: null as string | null,
    candidates: [] as string[],
    tie_break: null as string | null,
    variant_index: 0,
    suppression_skipped: false,
  };

  let patternId: PatternId;

  // --- Rule 1: Undifferentiated guard ---
  const values = DIMENSIONS.map((d) => state[d]);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  if (maxVal - minVal < 0.15) {
    debug.guard_fired = 'undifferentiated';
    if (mean < 0.7) {
      patternId = 'calm';
      debug.candidates = ['calm'];
      return buildResult(patternId, language, directiveHistory, debug);
    }
    // mean >= 0.7: fall through to rule 4 (skip rules 2 & 3)
  }

  // --- Rule 2: Suppression staleness ---
  if (debug.guard_fired !== 'undifferentiated') {
    if (suppressionCount > 0 && lastSuppressTime) {
      const elapsed = (Date.now() - new Date(lastSuppressTime).getTime()) / 3_600_000;
      const staleWindow = sessionTimeoutHours / 2;
      if (elapsed <= staleWindow) {
        patternId = 'suppression';
        debug.candidates = ['suppression'];
        return buildResult(patternId, language, directiveHistory, debug);
      }
    }
    debug.suppression_skipped = true;

    // --- Rule 3: Compound patterns ---
    if (state.trust >= 0.8 && state.joy >= 0.4) {
      patternId = 'intimate_trust';
      debug.candidates = ['intimate_trust'];
      return buildResult(patternId, language, directiveHistory, debug);
    }
    if (state.anger >= 0.5 && state.sadness >= 0.5) {
      // Must pass undifferentiated guard (which it did — guard didn't fire or fell through)
      patternId = 'mixed_conflict';
      debug.candidates = ['mixed_conflict'];
      return buildResult(patternId, language, directiveHistory, debug);
    }
  }

  // --- Rule 4: Single dominant ---
  const dominant = DIMENSIONS.filter((d) => state[d] >= 0.6);
  debug.candidates = dominant.length > 0 ? [...dominant] : ['calm'];

  if (dominant.length === 1) {
    patternId = dominant[0] as PatternId;
    return buildResult(patternId, language, directiveHistory, debug);
  }

  if (dominant.length > 1) {
    // --- Rule 6: Tie-breaking ---
    // Sort by value descending
    dominant.sort((a, b) => state[b] - state[a]);
    const top = state[dominant[0]];
    const second = state[dominant[1]];

    if (top - second > 0.05) {
      patternId = dominant[0] as PatternId;
      debug.tie_break = `highest: ${dominant[0]}`;
      return buildResult(patternId, language, directiveHistory, debug);
    }

    // Within 0.05 — use priority order
    const winner = TIE_BREAK_PRIORITY.find((d) => dominant.includes(d))!;
    patternId = winner as PatternId;
    debug.tie_break = `priority: ${winner}`;
    return buildResult(patternId, language, directiveHistory, debug);
  }

  // --- Rule 5: Fall back to calm ---
  patternId = 'calm';
  return buildResult(patternId, language, directiveHistory, debug);
}

function buildResult(
  patternId: PatternId,
  language: Language,
  directiveHistory: string[],
  debug: DirectiveResult['debug'] & object,
): DirectiveResult {
  const variants = DIRECTIVE_TEMPLATES[patternId][language];

  // Variant cycling: count consecutive repeats of this pattern from the END of history
  let repeatCount = 0;
  for (let i = directiveHistory.length - 1; i >= 0; i--) {
    if (directiveHistory[i] === patternId) repeatCount++;
    else break;
  }
  const variantIndex = repeatCount % variants.length;
  debug.variant_index = variantIndex;

  return {
    directive: variants[variantIndex],
    patternId,
    debug,
  };
}
