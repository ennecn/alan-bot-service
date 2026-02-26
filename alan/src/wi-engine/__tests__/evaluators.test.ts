import { describe, it, expect } from 'vitest';
import { evaluateState } from '../state-evaluator.js';
import type { StateEntry } from '../state-evaluator.js';
import { evaluateTemporal } from '../temporal-evaluator.js';
import type { EmotionState } from '../../types/index.js';

function makeEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    joy: 0.5,
    sadness: 0.5,
    anger: 0.5,
    anxiety: 0.5,
    longing: 0.5,
    trust: 0.5,
    ...overrides,
  };
}

// ============================================================
// State Evaluator
// ============================================================

describe('evaluateState', () => {
  it('returns 1.0 when single condition is met', () => {
    const entries = [{ id: 'e1', state_conditions: { joy: { min: 0.3 } } }];
    const scores = evaluateState(entries, makeEmotionState({ joy: 0.5 }));
    expect(scores.get('e1')).toBe(1.0);
  });

  it('returns 1.0 when all multiple conditions are met', () => {
    const entries = [{
      id: 'e1',
      state_conditions: { joy: { min: 0.5 }, anger: { max: 0.2 } },
    }];
    const scores = evaluateState(entries, makeEmotionState({ joy: 0.7, anger: 0.1 }));
    expect(scores.get('e1')).toBe(1.0);
  });

  it('returns fractional score when some conditions met', () => {
    const entries = [{
      id: 'e1',
      state_conditions: { joy: { min: 0.5 }, anger: { max: 0.2 } },
    }];
    // joy=0.3 fails min:0.5, anger=0.1 passes max:0.2
    const scores = evaluateState(entries, makeEmotionState({ joy: 0.3, anger: 0.1 }));
    expect(scores.get('e1')).toBe(0.5);
  });

  it('returns 0 when no conditions are defined', () => {
    const entries = [{ id: 'e1' }];
    const scores = evaluateState(entries, makeEmotionState());
    expect(scores.get('e1')).toBe(0);
  });

  it('returns 0 for empty state_conditions object', () => {
    const entries = [{ id: 'e1', state_conditions: {} }];
    const scores = evaluateState(entries, makeEmotionState());
    expect(scores.get('e1')).toBe(0);
  });

  it('handles boundary value — exact min', () => {
    const entries = [{ id: 'e1', state_conditions: { joy: { min: 0.5 } } }];
    const scores = evaluateState(entries, makeEmotionState({ joy: 0.5 }));
    expect(scores.get('e1')).toBe(1.0);
  });

  it('handles boundary value — exact max', () => {
    const entries = [{ id: 'e1', state_conditions: { anger: { max: 0.5 } } }];
    const scores = evaluateState(entries, makeEmotionState({ anger: 0.5 }));
    expect(scores.get('e1')).toBe(1.0);
  });

  it('fails when value is just below min', () => {
    const entries = [{ id: 'e1', state_conditions: { joy: { min: 0.5 } } }];
    const scores = evaluateState(entries, makeEmotionState({ joy: 0.499 }));
    expect(scores.get('e1')).toBe(0);
  });

  it('fails when value is just above max', () => {
    const entries = [{ id: 'e1', state_conditions: { anger: { max: 0.5 } } }];
    const scores = evaluateState(entries, makeEmotionState({ anger: 0.501 }));
    expect(scores.get('e1')).toBe(0);
  });

  it('handles min+max range on same dimension', () => {
    const entries = [{
      id: 'e1',
      state_conditions: { joy: { min: 0.3, max: 0.7 } },
    }];
    expect(evaluateState(entries, makeEmotionState({ joy: 0.5 })).get('e1')).toBe(1.0);
    expect(evaluateState(entries, makeEmotionState({ joy: 0.1 })).get('e1')).toBe(0);
    expect(evaluateState(entries, makeEmotionState({ joy: 0.9 })).get('e1')).toBe(0);
  });

  it('scores multiple entries independently', () => {
    const entries: StateEntry[] = [
      { id: 'e1', state_conditions: { joy: { min: 0.8 } } },
      { id: 'e2', state_conditions: { anger: { max: 0.3 } } },
    ];
    const state = makeEmotionState({ joy: 0.9, anger: 0.1 });
    const scores = evaluateState(entries, state);
    expect(scores.get('e1')).toBe(1.0);
    expect(scores.get('e2')).toBe(1.0);
  });

  it('returns 0/3 when no conditions met', () => {
    const entries = [{
      id: 'e1',
      state_conditions: {
        joy: { min: 0.9 },
        anger: { max: 0.1 },
        trust: { min: 0.8 },
      },
    }];
    const state = makeEmotionState({ joy: 0.1, anger: 0.9, trust: 0.2 });
    const scores = evaluateState(entries, state);
    expect(scores.get('e1')).toBeCloseTo(0);
  });

  it('returns 2/3 when two of three conditions met', () => {
    const entries = [{
      id: 'e1',
      state_conditions: {
        joy: { min: 0.5 },    // met (0.7)
        anger: { max: 0.3 },  // met (0.1)
        trust: { min: 0.9 },  // not met (0.5)
      },
    }];
    const state = makeEmotionState({ joy: 0.7, anger: 0.1, trust: 0.5 });
    const scores = evaluateState(entries, state);
    expect(scores.get('e1')).toBeCloseTo(2 / 3);
  });
});

// ============================================================
// Temporal Evaluator
// ============================================================

describe('evaluateTemporal', () => {
  // Helper to create a Date at specific time
  function makeDate(hour: number, minute: number, dayOfWeek?: number): Date {
    // 2026-02-26 is a Thursday (day 4)
    // Pick a date that matches the desired day of week
    const baseDate = new Date(2026, 1, 22); // Sunday Feb 22
    const day = dayOfWeek ?? 4; // default Thursday
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + day);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  it('returns 1.0 when within time range', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '09:00', before: '17:00' },
    }];
    const scores = evaluateTemporal(entries, makeDate(12, 0));
    expect(scores.get('e1')).toBe(1.0);
  });

  it('returns 0.0 when outside time range', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '09:00', before: '17:00' },
    }];
    const scores = evaluateTemporal(entries, makeDate(20, 0));
    expect(scores.get('e1')).toBe(0);
  });

  it('handles midnight crossing — within range (late night)', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '22:00', before: '06:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(23, 30)).get('e1')).toBe(1.0);
  });

  it('handles midnight crossing — within range (early morning)', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '22:00', before: '06:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(3, 0)).get('e1')).toBe(1.0);
  });

  it('handles midnight crossing — outside range (daytime)', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '22:00', before: '06:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(12, 0)).get('e1')).toBe(0);
  });

  it('matches day_of_week', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { day_of_week: [1, 3, 5] }, // Mon, Wed, Fri
    }];
    // Wednesday = 3
    expect(evaluateTemporal(entries, makeDate(12, 0, 3)).get('e1')).toBe(1.0);
  });

  it('rejects wrong day_of_week', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { day_of_week: [1, 3, 5] }, // Mon, Wed, Fri
    }];
    // Thursday = 4
    expect(evaluateTemporal(entries, makeDate(12, 0, 4)).get('e1')).toBe(0);
  });

  it('checks combined time + day_of_week', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '09:00', before: '17:00', day_of_week: [1, 2, 3, 4, 5] },
    }];
    // Wednesday at 12:00 = passes both
    expect(evaluateTemporal(entries, makeDate(12, 0, 3)).get('e1')).toBe(1.0);
    // Wednesday at 20:00 = fails time
    expect(evaluateTemporal(entries, makeDate(20, 0, 3)).get('e1')).toBe(0);
    // Sunday at 12:00 = fails day
    expect(evaluateTemporal(entries, makeDate(12, 0, 0)).get('e1')).toBe(0);
  });

  it('returns 0 when no temporal_conditions defined', () => {
    const entries = [{ id: 'e1' }];
    const scores = evaluateTemporal(entries, makeDate(12, 0));
    expect(scores.get('e1')).toBe(0);
  });

  it('returns 1.0 with only after condition met', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '09:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(10, 0)).get('e1')).toBe(1.0);
    expect(evaluateTemporal(entries, makeDate(8, 0)).get('e1')).toBe(0);
  });

  it('returns 1.0 with only before condition met', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { before: '17:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(10, 0)).get('e1')).toBe(1.0);
    expect(evaluateTemporal(entries, makeDate(18, 0)).get('e1')).toBe(0);
  });

  it('boundary — exactly at after time', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '09:00', before: '17:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(9, 0)).get('e1')).toBe(1.0);
  });

  it('boundary — exactly at before time', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { after: '09:00', before: '17:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(17, 0)).get('e1')).toBe(1.0);
  });

  it('empty day_of_week array passes day check', () => {
    const entries = [{
      id: 'e1',
      temporal_conditions: { day_of_week: [], after: '09:00', before: '17:00' },
    }];
    expect(evaluateTemporal(entries, makeDate(12, 0)).get('e1')).toBe(1.0);
  });

  it('scores multiple entries independently', () => {
    const entries = [
      { id: 'e1', temporal_conditions: { after: '09:00', before: '12:00' } },
      { id: 'e2', temporal_conditions: { after: '14:00', before: '18:00' } },
    ];
    const scores = evaluateTemporal(entries, makeDate(10, 0));
    expect(scores.get('e1')).toBe(1.0);
    expect(scores.get('e2')).toBe(0);
  });
});
