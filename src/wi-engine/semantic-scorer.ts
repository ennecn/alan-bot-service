/**
 * SemanticScorer — Signal 2: cosine similarity between query and entry embeddings.
 * PRD v6.0 §3.5
 */

import type { WIEntry } from '../types/actions.js';

/** Compute cosine similarity between two vectors. Returns 0 for zero-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  // Cosine similarity is [-1, 1]; normalize to [0, 1]
  return (dot / denom + 1) / 2;
}

/**
 * Score entries by cosine similarity to the query embedding.
 * Entries with embedding === 'pending' or no embedding get score 0.
 */
export function scoreEntries(queryEmbedding: number[], entries: WIEntry[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.embedding || entry.embedding === 'pending') {
      scores.set(entry.id, 0);
      continue;
    }

    scores.set(entry.id, cosineSimilarity(queryEmbedding, entry.embedding));
  }

  return scores;
}
