import { describe, it, expect } from 'vitest';
import { writeDirective } from '../narrativizer.js';
import type { EmotionState } from '../../types/index.js';

function makeState(overrides: Partial<EmotionState> = {}): EmotionState {
  return { joy: 0.3, sadness: 0.3, anger: 0.3, anxiety: 0.3, longing: 0.3, trust: 0.3, ...overrides };
}

describe('writeDirective', () => {
  // --- Pattern matching ---

  it('returns calm for all-low emotions', () => {
    const result = writeDirective({ state: makeState({ joy: 0.1, sadness: 0.1, anger: 0.1, anxiety: 0.1, longing: 0.1, trust: 0.1 }), language: 'zh' });
    expect(result.patternId).toBe('calm');
    expect(result.directive).toBeTruthy();
  });

  it('returns calm for undifferentiated emotions (spread < 0.15, mean < 0.7)', () => {
    // All values close together, low mean
    const result = writeDirective({ state: makeState({ joy: 0.4, sadness: 0.35, anger: 0.38, anxiety: 0.36, longing: 0.37, trust: 0.39 }), language: 'en' });
    expect(result.patternId).toBe('calm');
    expect(result.debug?.guard_fired).toBe('undifferentiated');
  });

  it('falls through undifferentiated guard when mean >= 0.7', () => {
    // All values high and close together
    const result = writeDirective({ state: makeState({ joy: 0.75, sadness: 0.72, anger: 0.73, anxiety: 0.74, longing: 0.76, trust: 0.75 }), language: 'zh' });
    // Should NOT be calm — should fall through to rule 4
    expect(result.patternId).not.toBe('calm');
    expect(result.debug?.guard_fired).toBe('undifferentiated');
  });

  it('returns sadness for high sadness', () => {
    const result = writeDirective({ state: makeState({ sadness: 0.8 }), language: 'zh' });
    expect(result.patternId).toBe('sadness');
    expect(result.directive).toContain('留白');
  });

  it('returns joy for high joy', () => {
    const result = writeDirective({ state: makeState({ joy: 0.7 }), language: 'en' });
    expect(result.patternId).toBe('joy');
    expect(result.directive).toContain('sensory');
  });

  it('returns anger for high anger', () => {
    const result = writeDirective({ state: makeState({ anger: 0.7 }), language: 'ja' });
    expect(result.patternId).toBe('anger');
  });

  it('returns anxiety for high anxiety', () => {
    const result = writeDirective({ state: makeState({ anxiety: 0.65 }), language: 'zh' });
    expect(result.patternId).toBe('anxiety');
    expect(result.directive).toContain('碎片化');
  });

  it('returns longing for high longing', () => {
    const result = writeDirective({ state: makeState({ longing: 0.7 }), language: 'zh' });
    expect(result.patternId).toBe('longing');
    expect(result.directive).toContain('回忆');
  });

  // --- Compound patterns ---

  it('returns intimate_trust for trust >= 0.8 and joy >= 0.4', () => {
    const result = writeDirective({ state: makeState({ trust: 0.85, joy: 0.5 }), language: 'zh' });
    expect(result.patternId).toBe('intimate_trust');
    expect(result.directive).toContain('松弛');
  });

  it('returns mixed_conflict for anger >= 0.5 and sadness >= 0.5', () => {
    const result = writeDirective({ state: makeState({ anger: 0.6, sadness: 0.6 }), language: 'zh' });
    expect(result.patternId).toBe('mixed_conflict');
    expect(result.directive).toContain('潜台词');
  });

  // --- Suppression ---

  it('returns suppression when count > 0 and last_suppress is recent', () => {
    const now = new Date().toISOString();
    const result = writeDirective({
      state: makeState({ anger: 0.7 }),
      language: 'zh',
      suppressionCount: 2,
      lastSuppressTime: now,
      sessionTimeoutHours: 4,
    });
    expect(result.patternId).toBe('suppression');
    expect(result.directive).toContain('克制');
  });

  it('skips suppression when last_suppress is stale', () => {
    const staleTime = new Date(Date.now() - 4 * 3_600_000).toISOString(); // 4 hours ago
    const result = writeDirective({
      state: makeState({ anger: 0.7 }),
      language: 'zh',
      suppressionCount: 2,
      lastSuppressTime: staleTime,
      sessionTimeoutHours: 4, // stale window = 2 hours
    });
    expect(result.patternId).toBe('anger');
    expect(result.debug?.suppression_skipped).toBe(true);
  });

  // --- Tie-breaking ---

  it('breaks ties by value difference > 0.05', () => {
    // Use sadness + anxiety (no compound pattern between them)
    const result = writeDirective({ state: makeState({ sadness: 0.7, anxiety: 0.62 }), language: 'en' });
    expect(result.patternId).toBe('sadness');
    expect(result.debug?.tie_break).toContain('highest');
  });

  it('breaks ties by priority when values within 0.05', () => {
    // sadness has higher priority than anxiety
    const result = writeDirective({ state: makeState({ sadness: 0.7, anxiety: 0.7 }), language: 'en' });
    expect(result.patternId).toBe('sadness');
    expect(result.debug?.tie_break).toContain('priority');
  });

  // --- Variant cycling ---

  it('cycles to variant 1 on consecutive repeat', () => {
    const result = writeDirective({
      state: makeState({ sadness: 0.8 }),
      language: 'zh',
      directiveHistory: ['sadness'],
    });
    expect(result.patternId).toBe('sadness');
    expect(result.debug?.variant_index).toBe(1);
    // Second variant contains '环境'
    expect(result.directive).toContain('环境');
  });

  it('wraps variant index on overflow', () => {
    const result = writeDirective({
      state: makeState({ sadness: 0.8 }),
      language: 'zh',
      directiveHistory: ['sadness', 'sadness'],
    });
    expect(result.patternId).toBe('sadness');
    // 2 repeats → index 2 % 2 = 0, back to first variant
    expect(result.debug?.variant_index).toBe(0);
  });

  it('resets variant count when history has different pattern', () => {
    const result = writeDirective({
      state: makeState({ sadness: 0.8 }),
      language: 'zh',
      directiveHistory: ['sadness', 'joy'],
    });
    expect(result.patternId).toBe('sadness');
    // Last entry is 'joy', not 'sadness', so repeat count = 0
    expect(result.debug?.variant_index).toBe(0);
  });

  // --- Language coverage ---

  it('returns en directive for english', () => {
    const result = writeDirective({ state: makeState({ joy: 0.7 }), language: 'en' });
    expect(result.directive).toMatch(/[a-zA-Z]/);
  });

  it('returns ja directive for japanese', () => {
    const result = writeDirective({ state: makeState({ joy: 0.7 }), language: 'ja' });
    // Japanese text present
    expect(result.directive).toMatch(/[\u3040-\u309F\u30A0-\u30FF]/);
  });

  // --- Return structure ---

  it('returns structured result with directive, patternId, and debug', () => {
    const result = writeDirective({ state: makeState({ joy: 0.7 }), language: 'zh' });
    expect(result).toHaveProperty('directive');
    expect(result).toHaveProperty('patternId');
    expect(result).toHaveProperty('debug');
    expect(typeof result.directive).toBe('string');
    expect(typeof result.patternId).toBe('string');
    expect(result.directive.length).toBeGreaterThan(0);
  });
});
