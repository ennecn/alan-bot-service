import { describe, it, expect } from 'vitest';
import { narrativize } from '../narrativizer.js';
import type { EmotionState } from '../../types/index.js';

describe('narrativize', () => {
  it('skips dimensions below 0.2', () => {
    const state: EmotionState = { joy: 0.1, sadness: 0.1, anger: 0.1, anxiety: 0.1, longing: 0.1, trust: 0.1 };
    expect(narrativize(state, 'en')).toBe('A calm, neutral state.');
    expect(narrativize(state, 'zh')).toBe('内心平静。');
    expect(narrativize(state, 'ja')).toBe('心は穏やかだ。');
  });

  it('produces mild for 0.2-0.4 range', () => {
    const state: EmotionState = { joy: 0.3, sadness: 0.0, anger: 0.0, anxiety: 0.0, longing: 0.0, trust: 0.0 };
    const result = narrativize(state, 'en');
    expect(result).toContain('faint warmth');
  });

  it('produces extreme for >= 0.8', () => {
    const state: EmotionState = { joy: 0.0, sadness: 0.9, anger: 0.0, anxiety: 0.0, longing: 0.0, trust: 0.0 };
    expect(narrativize(state, 'en')).toContain('crushing grief');
  });

  it('joins multiple emotions', () => {
    const state: EmotionState = { joy: 0.5, sadness: 0.0, anger: 0.7, anxiety: 0.0, longing: 0.0, trust: 0.3 };
    const result = narrativize(state, 'en');
    expect(result).toContain('quiet happiness');
    expect(result).toContain('burning anger');
    expect(result).toContain('cautious openness');
  });

  it('uses custom templates when provided', () => {
    const state: EmotionState = { joy: 0.5, sadness: 0.0, anger: 0.0, anxiety: 0.0, longing: 0.0, trust: 0.0 };
    const custom = { joy: { moderate: 'custom joy text' } };
    const result = narrativize(state, 'en', custom);
    expect(result).toContain('custom joy text');
  });

  it('generates Chinese output', () => {
    const state: EmotionState = { joy: 0.0, sadness: 0.0, anger: 0.0, anxiety: 0.5, longing: 0.0, trust: 0.0 };
    const result = narrativize(state, 'zh');
    expect(result).toContain('渐增的担忧');
    expect(result).toMatch(/^感受到/);
  });

  it('generates Japanese output', () => {
    const state: EmotionState = { joy: 0.0, sadness: 0.0, anger: 0.0, anxiety: 0.0, longing: 0.85, trust: 0.0 };
    const result = narrativize(state, 'ja');
    expect(result).toContain('胸が張り裂ける想い');
  });
});
