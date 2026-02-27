import { describe, it, expect } from 'vitest';
import { getBannedWordText, getAbsoluteBanWords } from '../banned-words.js';

const LANGUAGES = ['zh', 'en', 'ja'] as const;

describe('getBannedWordText', () => {
  it.each(LANGUAGES)('returns non-empty text for language=%s', (lang) => {
    const text = getBannedWordText(lang);
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(0);
  });

  it('zh text contains "禁" (ban character)', () => {
    const text = getBannedWordText('zh');
    expect(text).toContain('禁');
  });

  it('en text contains the word "ban"', () => {
    const text = getBannedWordText('en');
    // "Banned Expressions" or "Absolute ban"
    expect(text.toLowerCase()).toContain('ban');
  });

  it('ja text contains "禁止" (ban)', () => {
    const text = getBannedWordText('ja');
    expect(text).toContain('禁止');
  });

  it('zh text includes section headers', () => {
    const text = getBannedWordText('zh');
    expect(text).toContain('禁用表达');
    expect(text).toContain('绝对禁止');
    expect(text).toContain('慎用');
    expect(text).toContain('替代示例');
  });

  it('en text includes section headers', () => {
    const text = getBannedWordText('en');
    expect(text).toContain('Banned Expressions');
    expect(text).toContain('Absolute ban');
    expect(text).toContain('Cautious use');
    expect(text).toContain('Replacement examples');
  });

  it('ja text includes section headers', () => {
    const text = getBannedWordText('ja');
    expect(text).toContain('禁止表現');
    expect(text).toContain('絶対禁止');
    expect(text).toContain('代替例');
  });
});

describe('getAbsoluteBanWords', () => {
  it.each(LANGUAGES)('returns a non-empty array for language=%s', (lang) => {
    const words = getAbsoluteBanWords(lang);
    expect(Array.isArray(words)).toBe(true);
    expect(words.length).toBeGreaterThan(0);
  });

  it('every entry is a non-empty string', () => {
    for (const lang of LANGUAGES) {
      const words = getAbsoluteBanWords(lang);
      for (const w of words) {
        expect(typeof w).toBe('string');
        expect(w.length).toBeGreaterThan(0);
      }
    }
  });

  // ── zh known entries ─────────────────────────────────────────

  it('zh absolute ban includes "心中涌起"', () => {
    const words = getAbsoluteBanWords('zh');
    expect(words).toContain('心中涌起');
  });

  it('zh absolute ban includes "某种难以言表的"', () => {
    const words = getAbsoluteBanWords('zh');
    expect(words).toContain('某种难以言表的');
  });

  it('zh absolute ban includes "涌上心头"', () => {
    const words = getAbsoluteBanWords('zh');
    expect(words).toContain('涌上心头');
  });

  it('zh absolute ban does NOT include cautious-level words like "涟漪"', () => {
    const words = getAbsoluteBanWords('zh');
    expect(words).not.toContain('涟漪');
    expect(words).not.toContain('石子');
    expect(words).not.toContain('手术刀');
  });

  // ── en known entries ─────────────────────────────────────────

  it('en absolute ban includes known phrases', () => {
    const words = getAbsoluteBanWords('en');
    expect(words).toContain('a shiver ran down');
    expect(words).toContain('time seemed to stop');
    expect(words).toContain('orbs');
    expect(words).toContain('ministrations');
    expect(words).toContain('the air crackled');
  });

  it('en absolute ban does NOT include cautious-level "suddenly"', () => {
    const words = getAbsoluteBanWords('en');
    expect(words).not.toContain('suddenly');
  });

  // ── ja known entries ─────────────────────────────────────────

  it('ja absolute ban includes known phrases', () => {
    const words = getAbsoluteBanWords('ja');
    expect(words).toContain('言い表せない何か');
    expect(words).toContain('胸の奥が熱くなる');
    expect(words).toContain('時が止まったかのように');
  });

  it('ja absolute ban does NOT include cautious-level "突然"', () => {
    const words = getAbsoluteBanWords('ja');
    expect(words).not.toContain('突然');
  });
});
