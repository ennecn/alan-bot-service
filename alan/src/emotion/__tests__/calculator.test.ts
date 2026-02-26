import { describe, it, expect } from 'vitest';
import { updateEmotion, makeEmotionState, makeDefaultHalfLife } from '../calculator.js';
import type { EmotionState } from '../../types/index.js';

describe('updateEmotion', () => {
  const baseline = makeEmotionState(0.3);
  const halfLife = makeDefaultHalfLife();

  it('decays toward baseline with no delta', () => {
    const current = makeEmotionState(0.8);
    const result = updateEmotion(current, baseline, halfLife, 2.0, {});
    // After 1 half-life (2h), difference should be ~36.8% of original (exp(-1) ≈ 0.368)
    // decayed = 0.3 + (0.8 - 0.3) * exp(-2/2) = 0.3 + 0.5 * 0.368 = 0.484
    expect(result.joy).toBeCloseTo(0.484, 2);
    expect(result.anger).toBeCloseTo(0.484, 2);
  });

  it('returns baseline when elapsed is very large', () => {
    const current = makeEmotionState(0.9);
    const result = updateEmotion(current, baseline, halfLife, 100, {});
    for (const d of ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'] as const) {
      expect(result[d]).toBeCloseTo(baseline[d], 4);
    }
  });

  it('applies clamped deltas', () => {
    const current = makeEmotionState(0.5);
    const result = updateEmotion(current, baseline, halfLife, 0, { joy: 0.5 });
    // delta clamped to 0.3, no decay at elapsed=0 → 0.5 + 0.3 = 0.8
    expect(result.joy).toBeCloseTo(0.8, 4);
  });

  it('clamps negative deltas to -0.3', () => {
    const current = makeEmotionState(0.5);
    const result = updateEmotion(current, baseline, halfLife, 0, { trust: -0.8 });
    // delta clamped to -0.3 → 0.5 - 0.3 = 0.2
    expect(result.trust).toBeCloseTo(0.2, 4);
  });

  it('clamps final value to [0, 1]', () => {
    const current = makeEmotionState(0.95);
    const result = updateEmotion(current, baseline, halfLife, 0, { joy: 0.3 });
    expect(result.joy).toBe(1.0);

    const low: EmotionState = makeEmotionState(0.05);
    const result2 = updateEmotion(low, baseline, halfLife, 0, { joy: -0.3 });
    expect(result2.joy).toBe(0);
  });

  it('preserves dimensions without deltas', () => {
    const current: EmotionState = { joy: 0.7, sadness: 0.2, anger: 0.1, anxiety: 0.9, longing: 0.5, trust: 0.6 };
    const result = updateEmotion(current, baseline, halfLife, 0, { joy: 0.1 });
    // Only joy should change; others stay the same (elapsed=0, no delta)
    expect(result.joy).toBeCloseTo(0.8, 4);
    expect(result.sadness).toBeCloseTo(0.2, 4);
    expect(result.anger).toBeCloseTo(0.1, 4);
  });

  it('uses custom half-life per dimension', () => {
    const current = makeEmotionState(0.8);
    const customHL = { ...halfLife, joy: 1.0 }; // joy decays faster
    const result = updateEmotion(current, baseline, customHL, 2.0, {});
    // joy: 0.3 + 0.5 * exp(-2/1) = 0.3 + 0.5 * 0.135 = 0.368
    // anger: 0.3 + 0.5 * exp(-2/2) = 0.484
    expect(result.joy).toBeCloseTo(0.368, 2);
    expect(result.anger).toBeCloseTo(0.484, 2);
  });
});
