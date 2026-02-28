/**
 * Banned Words — Multi-language banned word lists with two-level classification.
 * PRD §2.2.2
 */

type Language = 'zh' | 'en' | 'ja';

export interface BannedWordEntry {
  word: string;
  level: 'absolute' | 'cautious';
  replacement?: string;
}

const BANNED_WORDS: Record<Language, BannedWordEntry[]> = {
  zh: [
    // Absolute ban
    { word: '某种难以言表的', level: 'absolute', replacement: '她把勺子放下了，汤还没喝完' },
    { word: '声音不高，却', level: 'absolute' },
    { word: '不是A，而是B', level: 'absolute' },
    { word: '带着……特有的', level: 'absolute' },
    { word: '胸腔共鸣', level: 'absolute' },
    { word: '像一根针扎进', level: 'absolute', replacement: '她的手指在桌面上敲了两下，停住了' },
    { word: '涌上心头', level: 'absolute' },
    { word: '心中涌起', level: 'absolute' },
    { word: '某种', level: 'absolute' },
    // Cautious use — banned as cliché metaphor, allowed as literal description
    { word: '石子', level: 'cautious' },
    { word: '涟漪', level: 'cautious' },
    { word: '手术刀', level: 'cautious' },
  ],
  en: [
    // Absolute ban
    { word: "a shiver ran down", level: 'absolute' },
    { word: "the breath they didn't know they were holding", level: 'absolute' },
    { word: 'time seemed to stop', level: 'absolute' },
    { word: 'orbs', level: 'absolute' },
    { word: 'ministrations', level: 'absolute' },
    { word: 'the air crackled', level: 'absolute' },
    // Cautious use
    { word: 'suddenly', level: 'cautious' },
  ],
  ja: [
    // Absolute ban
    { word: '言い表せない何か', level: 'absolute' },
    { word: '胸の奥が熱くなる', level: 'absolute' },
    { word: '時が止まったかのように', level: 'absolute' },
    // Cautious use
    { word: '突然', level: 'cautious' },
  ],
};

const BANNED_WORD_TEXT: Record<Language, string> = {
  zh: `## 禁用表达
### 绝对禁止（任何场景）
"某种难以言表的"、"声音不高，却……"、"不是A，而是B"、"带着……特有的"、"胸腔共鸣"、"涌上心头"、"心中涌起"、"某种"

### 慎用（禁止作为比喻，允许作为字面描述）
石子、涟漪、手术刀——不要用作情绪比喻

### 替代示例
✗ "某种难以言表的情绪涌上心头" → ✓ "她把勺子放下了，汤还没喝完"
✗ "像一根针扎进心里" → ✓ "她的手指在桌面上敲了两下，停住了"`,

  en: `## Banned Expressions
### Absolute ban (any context)
"a shiver ran down [someone's] spine", "the breath they didn't know they were holding", "time seemed to stop", "orbs" (for eyes), "ministrations", "the air crackled"

### Cautious use (banned as cliché, allowed in dialogue)
"suddenly" — not as narrative transition, OK in direct speech

### Replacement examples
✗ "Time seemed to stop as their eyes met" → ✓ "She set her glass down mid-sip"
✗ "A shiver ran down her spine" → ✓ "She pulled her sleeve over her wrist"`,

  ja: `## 禁止表現
### 絶対禁止（あらゆる場面）
「言い表せない何か」「胸の奥が熱くなる」「時が止まったかのように」

### 慎用（比喩禁止、字面OK）
「突然」——地の文の転換には使わない。台詞内はOK

### 代替例
✗ 「言い表せない何かが胸に広がった」 → ✓ 「箸を置いて、味噌汁に目を落とした」
✗ 「突然、ドアが開いた」 → ✓ 「ドアノブの回る音で顔を上げた」`,
};

/**
 * Returns ~200 token formatted text for L1 prompt injection.
 */
export function getBannedWordText(language: Language): string {
  return BANNED_WORD_TEXT[language];
}

/**
 * Returns absolute-ban words only for post-processor regex scanning.
 */
export function getAbsoluteBanWords(language: Language): string[] {
  return BANNED_WORDS[language]
    .filter((e) => e.level === 'absolute')
    .map((e) => e.word);
}
