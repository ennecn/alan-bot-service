import { describe, it, expect } from 'vitest';
import { decideBehavior } from '../decision.js';
import type { ImpulseResult, SuppressionFatigue } from '../../types/index.js';

function makeImpulse(value: number, threshold = 0.6): ImpulseResult {
  return {
    value,
    fire_threshold: threshold,
    fired: value >= threshold,
    components: {
      base_impulse: value,
      emotion_urgency: 0,
      suppression_pressure: 0,
      memory_pressure: 0,
      time_pressure: 0,
      event_importance: 0,
      user_message_increment: 0,
    },
  };
}

function makeSuppression(consecutive = 0): SuppressionFatigue {
  return { count: 0, consecutive_hesitate: consecutive, accumulated: 0, last_suppress: null };
}

describe('decideBehavior', () => {
  describe('heartbeat/cron triggers (binary)', () => {
    it('replies when impulse >= threshold', () => {
      expect(decideBehavior(makeImpulse(0.7), 'heartbeat', makeSuppression())).toBe('reply');
      expect(decideBehavior(makeImpulse(0.6), 'cron', makeSuppression())).toBe('reply');
    });

    it('suppresses when impulse < threshold', () => {
      expect(decideBehavior(makeImpulse(0.5), 'heartbeat', makeSuppression())).toBe('suppress');
      expect(decideBehavior(makeImpulse(0.3), 'cron', makeSuppression())).toBe('suppress');
    });

    it('suppresses for other non-interactive triggers', () => {
      expect(decideBehavior(makeImpulse(0.3), 'social_notification', makeSuppression())).toBe('suppress');
      expect(decideBehavior(makeImpulse(0.3), 'fact_sync', makeSuppression())).toBe('suppress');
      expect(decideBehavior(makeImpulse(0.3), 'system_event', makeSuppression())).toBe('suppress');
    });
  });

  describe('user_message trigger (3-zone)', () => {
    const threshold = 0.6;
    const hesitateFloor = threshold * 0.6; // 0.36

    it('replies when impulse >= threshold', () => {
      expect(decideBehavior(makeImpulse(0.7), 'user_message', makeSuppression())).toBe('reply');
    });

    it('suppresses when impulse < hesitate floor', () => {
      expect(decideBehavior(makeImpulse(0.3), 'user_message', makeSuppression())).toBe('suppress');
    });

    it('hesitates in the middle zone with low consecutive_hesitate', () => {
      expect(decideBehavior(makeImpulse(0.5), 'user_message', makeSuppression(0))).toBe('hesitate');
      expect(decideBehavior(makeImpulse(0.5), 'user_message', makeSuppression(1))).toBe('hesitate');
    });

    it('forces reply after 2 consecutive hesitations', () => {
      expect(decideBehavior(makeImpulse(0.5), 'user_message', makeSuppression(2))).toBe('reply');
      expect(decideBehavior(makeImpulse(0.5), 'user_message', makeSuppression(5))).toBe('reply');
    });
  });

  describe('direct_message trigger (same as user_message)', () => {
    it('replies when impulse >= threshold', () => {
      expect(decideBehavior(makeImpulse(0.8), 'direct_message', makeSuppression())).toBe('reply');
    });

    it('hesitates in middle zone', () => {
      expect(decideBehavior(makeImpulse(0.5), 'direct_message', makeSuppression(0))).toBe('hesitate');
    });

    it('forces reply after 2 hesitations', () => {
      expect(decideBehavior(makeImpulse(0.5), 'direct_message', makeSuppression(2))).toBe('reply');
    });
  });
});
