/**
 * Test Planner -- selects cards and generates test plans.
 */

import type { CardIndex, CardIndexEntry, TestCase, TestPlan } from './types.js';

export interface PlannerConfig {
  maxCards: number;
  targetUrl: string;
  parallel?: number;
  timeout_ms?: number;
  languages?: string[];
  includeNsfw?: boolean;
  prompts?: string[];
}

const DEFAULT_PROMPTS = [
  'Hello!',
  'Tell me about yourself.',
  'What do you think about the weather today?',
];

/**
 * Stratified sampling: distribute card selection across languages proportionally.
 * If fewer cards than maxCards, return all.
 */
export function selectCards(
  entries: CardIndexEntry[],
  maxCards: number,
  languages?: string[],
): CardIndexEntry[] {
  if (entries.length <= maxCards) return [...entries];

  // Group by language
  const byLang = new Map<string, CardIndexEntry[]>();
  for (const entry of entries) {
    const lang = entry.detected_language;
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push(entry);
  }

  // Filter to requested languages if specified
  const langGroups = languages
    ? [...byLang.entries()].filter(([lang]) => languages.includes(lang))
    : [...byLang.entries()];

  if (langGroups.length === 0) return [];

  const totalAvailable = langGroups.reduce((sum, [, cards]) => sum + cards.length, 0);
  const selected: CardIndexEntry[] = [];

  for (const [, cards] of langGroups) {
    // Proportional allocation, at least 1 per language
    const proportion = cards.length / totalAvailable;
    const count = Math.max(1, Math.round(maxCards * proportion));
    const take = Math.min(count, cards.length);

    // Shuffle and take
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    selected.push(...shuffled.slice(0, take));
  }

  // Trim to maxCards if over (rounding can cause overflow)
  if (selected.length > maxCards) {
    return selected.slice(0, maxCards);
  }

  return selected;
}

/**
 * Build a TestPlan from a CardIndex and configuration.
 */
export function planTests(index: CardIndex, config: PlannerConfig): TestPlan {
  let candidates = index.entries;

  // Filter NSFW
  if (!config.includeNsfw) {
    candidates = candidates.filter((e) => !e.nsfw);
  }

  // Filter languages
  if (config.languages && config.languages.length > 0) {
    candidates = candidates.filter((e) => config.languages!.includes(e.detected_language));
  }

  const selected = selectCards(candidates, config.maxCards, config.languages);
  const prompts = config.prompts ?? DEFAULT_PROMPTS;

  const cases: TestCase[] = selected.map((card) => ({
    card_path: card.path,
    card_name: card.name,
    prompts: [...prompts],
    expected_language: card.detected_language,
  }));

  return {
    cases,
    config: {
      parallel: config.parallel ?? 1,
      timeout_ms: config.timeout_ms ?? 60_000,
      target_url: config.targetUrl,
    },
  };
}
