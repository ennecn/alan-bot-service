import { describe, it, expect } from 'vitest';
import { resolveDeliveryMode } from '../adapters/delivery-modes.js';
import type { EmotionState } from '../../types/index.js';

const base: EmotionState = { joy: 0.5, sadness: 0.3, anger: 0.2, anxiety: 0.3, longing: 0.4, trust: 0.5 };

describe('resolveDeliveryMode', () => {
  it('returns burst when joy > 0.7', () => {
    expect(resolveDeliveryMode({ ...base, joy: 0.8 })).toBe('burst');
  });

  it('returns minimal when anxiety > 0.6', () => {
    expect(resolveDeliveryMode({ ...base, anxiety: 0.7 })).toBe('minimal');
  });

  it('returns minimal when trust < 0.3', () => {
    expect(resolveDeliveryMode({ ...base, trust: 0.2 })).toBe('minimal');
  });

  it('returns single when sadness > 0.6', () => {
    expect(resolveDeliveryMode({ ...base, sadness: 0.7 })).toBe('single');
  });

  it('returns single when anger > 0.6', () => {
    expect(resolveDeliveryMode({ ...base, anger: 0.7 })).toBe('single');
  });

  it('returns fragmented for default emotion state', () => {
    expect(resolveDeliveryMode(base)).toBe('fragmented');
  });

  it('joy > 0.7 takes priority over sadness > 0.6', () => {
    expect(resolveDeliveryMode({ ...base, joy: 0.8, sadness: 0.7 })).toBe('burst');
  });

  it('anxiety > 0.6 takes priority over sadness > 0.6', () => {
    expect(resolveDeliveryMode({ ...base, anxiety: 0.7, sadness: 0.7 })).toBe('minimal');
  });
});
