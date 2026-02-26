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
