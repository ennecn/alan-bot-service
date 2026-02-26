/**
 * Pre-filter — Combine TextScanner + SemanticScorer to produce candidate set.
 * PRD v6.0 §3.5
 */

import type { WIEntry, WISignalWeights } from '../types/actions.js';
import { scanEntries } from './text-scanner.js';
import { scoreEntries } from './semantic-scorer.js';

const TOP_K = 50;

/**
 * Pre-filter WI entries using Signal 1 (text) + Signal 2 (semantic).
 * Returns top-K candidates sorted by combined score.
 *
 * If queryEmbedding is null, semantic weight is redistributed to text.
 */
export function preFilter(
  text: string,
  queryEmbedding: number[] | null,
  entries: WIEntry[],
  weights: WISignalWeights,
): WIEntry[] {
  const textScores = scanEntries(text, entries);

  let semanticScores: Map<string, number>;
  let wText: number;
  let wSemantic: number;

  if (queryEmbedding) {
    semanticScores = scoreEntries(queryEmbedding, entries);
    wText = weights.text_scanner;
    wSemantic = weights.semantic_scorer;
  } else {
    // No embedding — redistribute semantic weight to text
    semanticScores = new Map();
    wText = weights.text_scanner + weights.semantic_scorer;
    wSemantic = 0;
  }

  // Normalize weights for the 2-signal pre-filter stage
  const totalW = wText + wSemantic;
  const normText = totalW > 0 ? wText / totalW : 1;
  const normSemantic = totalW > 0 ? wSemantic / totalW : 0;

  // Score each entry
  const scored: { entry: WIEntry; score: number }[] = [];

  for (const entry of entries) {
    const ts = textScores.get(entry.id) ?? 0;
    const ss = semanticScores.get(entry.id) ?? 0;
    const combined = normText * ts + normSemantic * ss;

    if (combined > 0) {
      scored.push({ entry, score: combined });
    }
  }

  // Sort descending by score, take top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_K).map(s => s.entry);
}
