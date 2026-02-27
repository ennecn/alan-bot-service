import { describe, it, expect } from 'vitest';
import { getGuardText, MINIMAL_IDENTITY_FRAME } from '../guards.js';

const ALL_GUARD_IDS = [
  'anti_sublimation',
  'anti_deification',
  'anti_possessive',
  'anti_omniscience',
] as const;

const LANGUAGES = ['zh', 'en', 'ja'] as const;

describe('getGuardText', () => {
  // ── Defaults (all 4 guards enabled) ──────────────────────────

  it.each(LANGUAGES)('returns non-empty text for language=%s', (lang) => {
    const result = getGuardText(lang);
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('enabledGuards contains all 4 guard IDs by default', () => {
    const result = getGuardText('zh');
    expect(result.enabledGuards).toEqual([...ALL_GUARD_IDS]);
  });

  it('enabledGuards contains all 4 for every language', () => {
    for (const lang of LANGUAGES) {
      const result = getGuardText(lang);
      expect(result.enabledGuards).toHaveLength(4);
      for (const id of ALL_GUARD_IDS) {
        expect(result.enabledGuards).toContain(id);
      }
    }
  });

  // ── Disabling specific guards ────────────────────────────────

  it('disabling one guard removes it from enabledGuards', () => {
    const result = getGuardText('en', ['anti_sublimation']);
    expect(result.enabledGuards).not.toContain('anti_sublimation');
    expect(result.enabledGuards).toHaveLength(3);
    expect(result.enabledGuards).toContain('anti_deification');
    expect(result.enabledGuards).toContain('anti_possessive');
    expect(result.enabledGuards).toContain('anti_omniscience');
  });

  it('disabling one guard removes its text from output', () => {
    const full = getGuardText('en');
    const partial = getGuardText('en', ['anti_sublimation']);
    // Full includes "Anti-sublimation" header; partial does not
    expect(full.text).toContain('Anti-sublimation');
    expect(partial.text).not.toContain('Anti-sublimation');
  });

  it('disabling multiple guards removes all of them', () => {
    const result = getGuardText('zh', ['anti_sublimation', 'anti_deification']);
    expect(result.enabledGuards).toHaveLength(2);
    expect(result.enabledGuards).toContain('anti_possessive');
    expect(result.enabledGuards).toContain('anti_omniscience');
    expect(result.text).not.toContain('反升华');
    expect(result.text).not.toContain('反神化');
  });

  // ── Disabling ALL guards ─────────────────────────────────────

  it('disabling all guards returns empty text and empty enabledGuards', () => {
    const result = getGuardText('en', [...ALL_GUARD_IDS]);
    expect(result.text).toBe('');
    expect(result.enabledGuards).toEqual([]);
  });

  // ── Language-specific content checks ─────────────────────────

  it('zh guard text contains Chinese characters', () => {
    const result = getGuardText('zh');
    // Section header is "## 写作禁区"
    expect(result.text).toContain('写作禁区');
    // Guard names in Chinese
    expect(result.text).toContain('反升华');
    expect(result.text).toContain('反神化');
    expect(result.text).toContain('反占有');
    expect(result.text).toContain('反全知');
  });

  it('en guard text contains English words', () => {
    const result = getGuardText('en');
    expect(result.text).toContain('Writing Guardrails');
    expect(result.text).toContain('Anti-sublimation');
    expect(result.text).toContain('Anti-deification');
    expect(result.text).toContain('Anti-possessive');
    expect(result.text).toContain('Anti-omniscience');
  });

  it('ja guard text contains Japanese content', () => {
    const result = getGuardText('ja');
    expect(result.text).toContain('執筆禁止事項');
    expect(result.text).toContain('反昇華');
    expect(result.text).toContain('反神格化');
  });

  // ── Edge cases ───────────────────────────────────────────────

  it('passing undefined disabledGuards enables all guards', () => {
    const result = getGuardText('en', undefined);
    expect(result.enabledGuards).toHaveLength(4);
  });

  it('passing empty disabledGuards array enables all guards', () => {
    const result = getGuardText('en', []);
    expect(result.enabledGuards).toHaveLength(4);
  });

  it('passing unknown guard IDs in disabledGuards does not affect output', () => {
    const result = getGuardText('en', ['nonexistent_guard']);
    expect(result.enabledGuards).toHaveLength(4);
  });
});

describe('MINIMAL_IDENTITY_FRAME', () => {
  it.each(LANGUAGES)('is non-empty for language=%s', (lang) => {
    expect(MINIMAL_IDENTITY_FRAME[lang]).toBeTruthy();
    expect(MINIMAL_IDENTITY_FRAME[lang].length).toBeGreaterThan(0);
  });

  it('zh frame contains Chinese characters', () => {
    expect(MINIMAL_IDENTITY_FRAME.zh).toContain('角色');
  });

  it('en frame contains expected English content', () => {
    expect(MINIMAL_IDENTITY_FRAME.en).toContain('character');
  });

  it('ja frame contains expected Japanese content', () => {
    expect(MINIMAL_IDENTITY_FRAME.ja).toContain('物語');
  });
});
