import { describe, it, expect } from 'vitest';
import { calculateImpulse } from '../calculator.js';

describe('calculateImpulse', () => {
  it('returns base impulse with no other factors', () => {
    const result = calculateImpulse({
      emotionDeltas: {},
      suppressionCount: 0,
      hoursSinceLastInteraction: 0,
      eventImportance: 0,
      consecutiveUnreplied: 0,
    });
    // base=0.3, emotion=0, suppression=0, time=sigmoid(-2*1)*0.3≈0.036, event=0, msg=0
    // sigmoid(-2) = 1/(1+exp(2)) ≈ 0.119 → *0.3 ≈ 0.036
    expect(result.value).toBeCloseTo(0.3 + 0.119 * 0.3, 2);
    expect(result.fired).toBe(false);
    expect(result.fire_threshold).toBe(0.6);
  });

  it('fires when impulse exceeds threshold', () => {
    const result = calculateImpulse({
      emotionDeltas: { anger: 0.3 },
      suppressionCount: 2,
      hoursSinceLastInteraction: 4,
      eventImportance: 0.6,
      consecutiveUnreplied: 1,
    });
    // base=0.3 + anger=0.3 + supp=0.3 + time≈0.27 + event=0.12 + msg=0.1 = ~1.39 → clamped to 1.0
    expect(result.value).toBe(1.0);
    expect(result.fired).toBe(true);
  });

  it('computes each component correctly', () => {
    const result = calculateImpulse({
      baseImpulse: 0.2,
      emotionDeltas: { joy: 0.15, sadness: -0.1 },
      urgencyWeight: 1.0,
      suppressionCount: 1,
      hoursSinceLastInteraction: 2.0,
      timeThreshold: 2.0,
      steepness: 1.0,
      eventImportance: 0.3,
      consecutiveUnreplied: 2,
      userMessageIncrement: 0.1,
      fireThreshold: 0.6,
    });

    expect(result.components.base_impulse).toBe(0.2);
    expect(result.components.emotion_urgency).toBeCloseTo(0.15, 4); // max(0.15, 0.1) * 1.0
    expect(result.components.suppression_pressure).toBeCloseTo(0.15, 4); // 1 * 0.15
    expect(result.components.time_pressure).toBeCloseTo(0.15, 2); // sigmoid(0)*0.3 = 0.5*0.3
    expect(result.components.event_importance).toBeCloseTo(0.06, 4); // 0.3 * 0.2
    expect(result.components.user_message_increment).toBeCloseTo(0.2, 4); // 0.1 * 2
  });

  it('clamps to [0, 1]', () => {
    const result = calculateImpulse({
      baseImpulse: 0.9,
      emotionDeltas: { anger: 0.3 },
      suppressionCount: 5,
      hoursSinceLastInteraction: 10,
      eventImportance: 1.0,
      consecutiveUnreplied: 5,
    });
    expect(result.value).toBe(1.0);
  });

  it('uses custom fire threshold', () => {
    const result = calculateImpulse({
      emotionDeltas: {},
      suppressionCount: 0,
      hoursSinceLastInteraction: 0,
      eventImportance: 0,
      consecutiveUnreplied: 0,
      fireThreshold: 0.2,
    });
    expect(result.fire_threshold).toBe(0.2);
    // value ≈ 0.336, threshold 0.2 → fired
    expect(result.fired).toBe(true);
  });
});
