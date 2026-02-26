import { describe, it, expect, vi } from 'vitest';
import { scanEntries } from '../text-scanner.js';
import type { WIEntry } from '../../types/actions.js';

function makeEntry(overrides: Partial<WIEntry> & { id: string; keys: string[]; content: string }): WIEntry {
  return { enabled: true, ...overrides };
}

describe('scanEntries', () => {
  describe('basic keyword matching', () => {
    it('matches when primary key is found in text', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['dragon'], content: 'A fire dragon.' })];
      const scores = scanEntries('I saw a dragon in the sky', entries);
      expect(scores.get('e1')).toBe(1.0);
    });

    it('returns 0 when no key matches', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['dragon'], content: 'A fire dragon.' })];
      const scores = scanEntries('I saw a cat', entries);
      expect(scores.get('e1')).toBe(0);
    });

    it('matches any of multiple primary keys', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['dragon', 'wyrm'], content: 'content' })];
      expect(scanEntries('a wyrm appeared', entries).get('e1')).toBe(1.0);
    });
  });

  describe('case sensitivity', () => {
    it('is case-insensitive by default', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['Dragon'], content: 'c' })];
      expect(scanEntries('dragon', entries).get('e1')).toBe(1.0);
    });

    it('respects case_sensitive flag', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['Dragon'], content: 'c', case_sensitive: true })];
      expect(scanEntries('dragon', entries).get('e1')).toBe(0);
      expect(scanEntries('Dragon', entries).get('e1')).toBe(1.0);
    });
  });

  describe('whole words', () => {
    it('matches partial words by default', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['cat'], content: 'c' })];
      expect(scanEntries('concatenate', entries).get('e1')).toBe(1.0);
    });

    it('requires whole word boundary when whole_words is true', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['cat'], content: 'c', whole_words: true })];
      expect(scanEntries('concatenate', entries).get('e1')).toBe(0);
      expect(scanEntries('the cat sat', entries).get('e1')).toBe(1.0);
    });
  });

  describe('regex support', () => {
    it('treats keys as regex when regex=true', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['drag(on|oon)'], content: 'c', regex: true })];
      expect(scanEntries('dragoon rider', entries).get('e1')).toBe(1.0);
      expect(scanEntries('dragon rider', entries).get('e1')).toBe(1.0);
    });

    it('handles invalid regex gracefully', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['[invalid'], content: 'c', regex: true })];
      expect(scanEntries('anything', entries).get('e1')).toBe(0);
    });
  });

  describe('selective logic (secondary keys)', () => {
    it('AND_ANY: passes if any secondary key matches', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['hero'], secondary_keys: ['sword', 'shield'], selective_logic: 'AND_ANY', content: 'c' })];
      expect(scanEntries('the hero drew a sword', entries).get('e1')).toBe(1.0);
      expect(scanEntries('the hero rested', entries).get('e1')).toBe(0);
    });

    it('AND_ALL: passes only if all secondary keys match', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['hero'], secondary_keys: ['sword', 'shield'], selective_logic: 'AND_ALL', content: 'c' })];
      expect(scanEntries('hero with sword and shield', entries).get('e1')).toBe(1.0);
      expect(scanEntries('hero with sword', entries).get('e1')).toBe(0);
    });

    it('NOT_ANY: passes if no secondary key matches', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['hero'], secondary_keys: ['villain', 'evil'], selective_logic: 'NOT_ANY', content: 'c' })];
      expect(scanEntries('the hero arrived', entries).get('e1')).toBe(1.0);
      expect(scanEntries('the hero met the villain', entries).get('e1')).toBe(0);
    });

    it('NOT_ALL: passes if not all secondary keys match', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['hero'], secondary_keys: ['dark', 'evil'], selective_logic: 'NOT_ALL', content: 'c' })];
      expect(scanEntries('hero in dark times', entries).get('e1')).toBe(1.0);
      expect(scanEntries('hero in dark evil times', entries).get('e1')).toBe(0);
    });
  });

  describe('special flags', () => {
    it('skips disabled entries', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['dragon'], content: 'c', enabled: false })];
      expect(scanEntries('dragon', entries).get('e1')).toBe(0);
    });

    it('constant entries always score 1.0', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['xyz'], content: 'c', constant: true })];
      expect(scanEntries('no match here', entries).get('e1')).toBe(1.0);
    });

    it('probability gate filters some entries', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['dragon'], content: 'c', probability: 0 })];
      // probability=0 → Math.random() >= 0 is always true → always filtered
      expect(scanEntries('dragon', entries).get('e1')).toBe(0);
    });

    it('probability=1.0 always passes', () => {
      const entries = [makeEntry({ id: 'e1', keys: ['dragon'], content: 'c', probability: 1.0 })];
      // probability is not < 1.0, so gate is skipped
      expect(scanEntries('dragon', entries).get('e1')).toBe(1.0);
    });
  });
});
