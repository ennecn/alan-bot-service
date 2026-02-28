/**
 * Emotion Calculator — Deterministic emotion state updates with exponential decay.
 * PRD v6.0 §3.1.2
 */

import type { EmotionDimension, EmotionState } from '../types/index.js';

const DIMENSIONS: EmotionDimension[] = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'];
const DEFAULT_HALF_LIFE = 2.0; // hours
const MAX_DELTA = 0.3;

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Update emotion state with exponential decay toward baseline + clamped deltas.
 *
 * Per dimension d:
 *   decayed = baseline[d] + (old[d] - baseline[d]) * exp(-elapsed / halfLife[d])
 *   new[d]  = clamp(0, 1, decayed + clamp(-0.3, 0.3, delta[d] ?? 0))
 */
export function updateEmotion(
  current: EmotionState,
  baseline: EmotionState,
  halfLife: Partial<Record<EmotionDimension, number>>,
  elapsedHours: number,
  system1Delta: Partial<Record<EmotionDimension, number>>,
): EmotionState {
  const result = { ...current };

  for (const d of DIMENSIONS) {
    const hl = halfLife[d] ?? DEFAULT_HALF_LIFE;
    const decayed = baseline[d] + (current[d] - baseline[d]) * Math.exp(-elapsedHours / hl);
    const delta = clamp(-MAX_DELTA, MAX_DELTA, system1Delta[d] ?? 0);
    result[d] = clamp(0, 1, decayed + delta);
  }

  return result;
}

/** Create a default EmotionState with all dimensions at a given value. */
export function makeEmotionState(value = 0.5): EmotionState {
  return { joy: value, sadness: value, anger: value, anxiety: value, longing: value, trust: value };
}

/** Create a default half-life record. */
export function makeDefaultHalfLife(): Record<EmotionDimension, number> {
  return { joy: DEFAULT_HALF_LIFE, sadness: DEFAULT_HALF_LIFE, anger: DEFAULT_HALF_LIFE, anxiety: DEFAULT_HALF_LIFE, longing: DEFAULT_HALF_LIFE, trust: DEFAULT_HALF_LIFE };
}
