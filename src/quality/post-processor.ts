/**
 * Post-processor — Scan S2 output and S1 impulse_narrative for banned words.
 * PRD §2.3.3
 */

import { getAbsoluteBanWords } from './banned-words.js';

export type Language = 'zh' | 'en' | 'ja';

export interface PostProcessResult {
  /** Number of banned word hits found */
  hitCount: number;
  /** Which banned words were found */
  wordsFound: string[];
  /** Updated streak counts (merge into banned_word_streak) */
  updatedStreak: Record<string, number>;
  /** One-shot reinforcement text to inject in next turn's L3 (null if no reinforcement needed) */
  reinforcement: string | null;
}

const STREAK_THRESHOLD = 3;

const REINFORCEMENT_TEMPLATES: Record<Language, (word: string, count: number) => string> = {
  zh: (word, count) =>
    `注意：你已连续${count}次使用「${word}」。此表达被禁止。请使用具体的感官描写代替。`,
  en: (word, count) =>
    `CRITICAL: You have used '${word}' in ${count} consecutive replies. This expression is banned. Use concrete sensory details instead.`,
  ja: (word, count) =>
    `注意：「${word}」を${count}回連続使用しています。この表現は禁止です。具体的な感覚描写を使ってください。`,
};

function buildRegex(word: string, language: Language): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = language === 'en' ? 'gi' : 'g';
  return new RegExp(escaped, flags);
}

/**
 * Scan text for absolute-ban words. Track streaks.
 * If same word hit 3+ consecutive turns, produce reinforcement text.
 */
export function scanForBannedWords(
  text: string,
  language: Language,
  currentStreak: Record<string, number>,
): PostProcessResult {
  const banWords = getAbsoluteBanWords(language);
  const wordsFound: string[] = [];
  const updatedStreak: Record<string, number> = {};
  const reinforcements: string[] = [];

  for (const word of banWords) {
    const regex = buildRegex(word, language);
    if (regex.test(text)) {
      wordsFound.push(word);
      const newCount = (currentStreak[word] ?? 0) + 1;
      updatedStreak[word] = newCount;
      if (newCount >= STREAK_THRESHOLD) {
        reinforcements.push(REINFORCEMENT_TEMPLATES[language](word, newCount));
      }
    } else {
      // Reset streak for words not found this turn
      updatedStreak[word] = 0;
    }
  }

  return {
    hitCount: wordsFound.length,
    wordsFound,
    updatedStreak,
    reinforcement: reinforcements.length > 0 ? reinforcements.join('\n') : null,
  };
}

/**
 * Sanitize S1 impulse_narrative: replace absolute-ban word matches with [...].
 * Returns { sanitized: string; replaced: boolean }.
 */
export function sanitizeS1Output(
  text: string,
  language: Language,
): { sanitized: string; replaced: boolean } {
  const banWords = getAbsoluteBanWords(language);
  let sanitized = text;
  let replaced = false;

  for (const word of banWords) {
    const regex = buildRegex(word, language);
    if (regex.test(sanitized)) {
      replaced = true;
      sanitized = sanitized.replace(buildRegex(word, language), '[...]');
    }
  }

  return { sanitized, replaced };
}
