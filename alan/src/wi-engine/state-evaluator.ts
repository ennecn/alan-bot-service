/**
 * State Evaluator — Scores WI entries based on current emotion state.
 * PRD v6.0 §3.5
 *
 * Checks each entry's state_conditions against the current EmotionState.
 * Score = fraction of conditions met (0.0 to 1.0).
 */

import type { EmotionState, EmotionDimension } from '../types/index.js';

interface StateCondition {
  min?: number;
  max?: number;
}

type StateConditions = Partial<Record<EmotionDimension, StateCondition>>;

export interface StateEntry {
  id: string;
  state_conditions?: Record<string, { min?: number; max?: number }>;
}

/**
 * Evaluate entries against current emotion state.
 * Returns a Map of entry ID → score [0, 1].
 * Entries without state_conditions get score 0.
 */
export function evaluateState(
  entries: StateEntry[],
  emotionState: EmotionState,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.state_conditions || Object.keys(entry.state_conditions).length === 0) {
      result.set(entry.id, 0);
      continue;
    }

    const conditions = Object.entries(entry.state_conditions) as Array<[string, StateCondition]>;
    let met = 0;

    for (const [dimension, condition] of conditions) {
      const value = emotionState[dimension as EmotionDimension];
      if (value === undefined) continue;

      let conditionMet = true;
      if (condition.min !== undefined && value < condition.min) conditionMet = false;
      if (condition.max !== undefined && value > condition.max) conditionMet = false;

      if (conditionMet) met++;
    }

    result.set(entry.id, conditions.length > 0 ? met / conditions.length : 0);
  }

  return result;
}
