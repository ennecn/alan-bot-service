/**
 * Signal Combiner — Weighted sum of 4 WI signals.
 * PRD v6.0 §3.5
 */

import type { WISignalWeights } from '../types/actions.js';

export interface SignalScores {
  text: number;
  semantic: number;
  state: number;
  temporal: number;
}

/**
 * Combine 4 signal scores using weights.
 * For pure ST cards (state=0, temporal=0), auto-redistribute those weights
 * proportionally to text + semantic.
 */
export function combineSignals(scores: SignalScores, weights: WISignalWeights): number {
  const { text, semantic, state, temporal } = scores;

  // Detect pure ST card: no state/temporal signal contribution
  const isPureST = state === 0 && temporal === 0;

  let wText = weights.text_scanner;
  let wSemantic = weights.semantic_scorer;
  let wState = weights.state_evaluator;
  let wTemporal = weights.temporal_evaluator;

  if (isPureST) {
    // Redistribute state + temporal weights proportionally to text + semantic
    const surplus = wState + wTemporal;
    const base = wText + wSemantic;
    if (base > 0) {
      wText += surplus * (wText / base);
      wSemantic += surplus * (wSemantic / base);
    }
    wState = 0;
    wTemporal = 0;
  }

  const combined = wText * text + wSemantic * semantic + wState * state + wTemporal * temporal;
  return Math.min(1, Math.max(0, combined));
}
