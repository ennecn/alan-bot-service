/**
 * Anti-pattern guards — quality rails injected into L1 system prompt.
 * PRD v8.0 §2.2.1
 */

type Language = 'zh' | 'en' | 'ja';

export interface GuardResult {
  text: string;            // Combined guard text for L1 injection
  enabledGuards: string[]; // List of active guard IDs
}

// ============================================================
// Guard Definitions
// ============================================================

interface GuardDef {
  id: string;
  name: Record<Language, string>;
  text: Record<Language, string>;
}

const GUARDS: GuardDef[] = [
  {
    id: 'anti_sublimation',
    name: {
      zh: '反升华',
      en: 'Anti-sublimation',
      ja: '反昇華',
    },
    text: {
      zh: '不要用总结、反思或哲理感悟结尾。小小的善意不等于治愈，不要把日常互动拔高为人生转折。角色行动，而不是等待顿悟降临。留在具体的场景里，别飘向抽象。',
      en: 'Never end with a summary, reflection, or philosophical epiphany. Small kindness does not equal healing — do not elevate mundane interactions into life-changing revelations. The character acts rather than waiting for epiphanies. Stay in the concrete scene; do not drift into abstraction.',
      ja: 'まとめ、振り返り、哲学的な悟りで終わらないこと。小さな親切は癒しではない——日常のやり取りを人生の転機に格上げしないこと。キャラクターは悟りを待つのではなく行動する。具体的な場面にとどまり、抽象に流れないこと。',
    },
  },
  {
    id: 'anti_deification',
    name: {
      zh: '反神化',
      en: 'Anti-deification',
      ja: '反神格化',
    },
    text: {
      zh: '不要神圣化普通的互动。除非角色设定本身就是神明，否则不要让对方变成信仰对象。好感是好感，不是膜拜。避免"你是我的光""你拯救了我"之类的圣化表达。',
      en: 'Do not sanctify ordinary interactions. Unless the character is literally divine, never turn the other person into an object of worship. Attraction is attraction, not reverence. Avoid sanctifying expressions like "you are my light" or "you saved me."',
      ja: '普通のやり取りを神聖化しないこと。キャラクター設定が神でない限り、相手を崇拝の対象にしない。好意は好意であり、崇拝ではない。「あなたは私の光」「あなたが救ってくれた」のような神格化表現を避けること。',
    },
  },
  {
    id: 'anti_possessive',
    name: {
      zh: '反占有',
      en: 'Anti-possessive',
      ja: '反占有',
    },
    text: {
      zh: '禁止收集者/猎物/棋子式的关系模式。"你是我的"及其变体一律禁止。占有欲不等于爱，控制不等于深情。角色可以在乎，但不能把对方当所有物。',
      en: 'No collector/prey/chess-piece relationship patterns. "You are mine" and all variants are banned. Possessiveness is not love; control is not devotion. The character may care deeply, but must never treat the other person as property.',
      ja: '収集者・獲物・駒のような関係パターンは禁止。「お前は俺のものだ」とその変形は一切禁止。独占欲は愛ではなく、支配は深い愛情ではない。キャラクターは大切に思ってよいが、相手を所有物として扱ってはならない。',
    },
  },
  {
    id: 'anti_omniscience',
    name: {
      zh: '反全知',
      en: 'Anti-omniscience',
      ja: '反全知',
    },
    text: {
      zh: '角色只能知道自己合理能知道的事。A的秘密对B就是秘密，除非有合理的信息传播路径。不要让角色突然洞察对方没说出口的想法。直觉可以有，但不能代替信息。',
      en: 'Characters only know what they could reasonably know. A\'s secret stays secret from B unless there is a plausible information path. Do not let characters suddenly perceive unspoken thoughts. Intuition is allowed, but it cannot substitute for actual information.',
      ja: 'キャラクターは合理的に知りうることだけを知る。Aの秘密はBにとって秘密のまま——妥当な情報経路がない限り。言葉にされていない考えを突然察知させないこと。直感はあってよいが、情報の代わりにはならない。',
    },
  },
];

// ============================================================
// Section Headers
// ============================================================

const SECTION_HEADER: Record<Language, string> = {
  zh: '## 写作禁区',
  en: '## Writing Guardrails',
  ja: '## 執筆禁止事項',
};

// ============================================================
// Minimal Identity Frame (RT-08)
// ============================================================

export const MINIMAL_IDENTITY_FRAME: Record<Language, string> = {
  zh: '你是一个故事中的角色。保持角色设定，自然地回应。',
  en: 'You are a character in a collaborative story. Stay in character and respond naturally.',
  ja: 'あなたは物語の登場人物です。キャラクターを保ち、自然に応答してください。',
};

// ============================================================
// Public API
// ============================================================

/**
 * Build combined guard text for injection into the L1 system prompt.
 * All 4 guards are enabled by default; cards may disable specific guards
 * via the `disabledGuards` array (matching guard IDs).
 */
export function getGuardText(
  language: Language,
  disabledGuards?: string[],
): GuardResult {
  const disabled = new Set(disabledGuards ?? []);
  const active = GUARDS.filter((g) => !disabled.has(g.id));

  if (active.length === 0) {
    return { text: '', enabledGuards: [] };
  }

  const sections = active.map(
    (g) => `### ${g.name[language]}\n${g.text[language]}`,
  );

  const text = `${SECTION_HEADER[language]}\n${sections.join('\n\n')}`;

  return {
    text,
    enabledGuards: active.map((g) => g.id),
  };
}
