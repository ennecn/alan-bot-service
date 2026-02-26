/**
 * TextScanner — Signal 1: keyword/regex matching for WI entries.
 * PRD v6.0 §3.5
 */

import type { WIEntry } from '../types/actions.js';

/** Check if a single key matches the text. */
function keyMatches(text: string, key: string, opts: { regex?: boolean; whole_words?: boolean; case_sensitive?: boolean }): boolean {
  if (opts.regex) {
    try {
      const flags = opts.case_sensitive ? '' : 'i';
      return new RegExp(key, flags).test(text);
    } catch {
      return false; // invalid regex → no match
    }
  }

  const haystack = opts.case_sensitive ? text : text.toLowerCase();
  const needle = opts.case_sensitive ? key : key.toLowerCase();

  if (opts.whole_words) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = opts.case_sensitive ? '' : 'i';
    return new RegExp(`\\b${escaped}\\b`, flags).test(text);
  }

  return haystack.includes(needle);
}

/** Check if any key in the array matches. */
function anyKeyMatches(text: string, keys: string[], opts: { regex?: boolean; whole_words?: boolean; case_sensitive?: boolean }): boolean {
  return keys.some(k => keyMatches(text, k, opts));
}

/** Check if all keys in the array match. */
function allKeysMatch(text: string, keys: string[], opts: { regex?: boolean; whole_words?: boolean; case_sensitive?: boolean }): boolean {
  return keys.length > 0 && keys.every(k => keyMatches(text, k, opts));
}

/** Evaluate secondary keys with selective logic. */
function checkSecondaryKeys(text: string, entry: WIEntry, opts: { regex?: boolean; whole_words?: boolean; case_sensitive?: boolean }): boolean {
  const secondary = entry.secondary_keys;
  if (!secondary || secondary.length === 0) return true; // no secondary = pass

  const logic = entry.selective_logic ?? 'AND_ANY';

  switch (logic) {
    case 'AND_ANY':
      return anyKeyMatches(text, secondary, opts);
    case 'AND_ALL':
      return allKeysMatch(text, secondary, opts);
    case 'NOT_ANY':
      return !anyKeyMatches(text, secondary, opts);
    case 'NOT_ALL':
      return !allKeysMatch(text, secondary, opts);
    default:
      return true;
  }
}

/**
 * Scan text against WI entries and return binary scores.
 * Score is 1.0 if all conditions met, 0.0 otherwise.
 */
export function scanEntries(text: string, entries: WIEntry[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const entry of entries) {
    // Skip disabled entries
    if (entry.enabled === false) {
      scores.set(entry.id, 0);
      continue;
    }

    // Constant entries always activate
    if (entry.constant) {
      scores.set(entry.id, 1.0);
      continue;
    }

    const opts = {
      regex: entry.regex,
      whole_words: entry.whole_words,
      case_sensitive: entry.case_sensitive,
    };

    // Primary keys: at least one must match
    if (!anyKeyMatches(text, entry.keys, opts)) {
      scores.set(entry.id, 0);
      continue;
    }

    // Secondary keys with selective logic
    if (!checkSecondaryKeys(text, entry, opts)) {
      scores.set(entry.id, 0);
      continue;
    }

    // Probability gate
    if (entry.probability !== undefined && entry.probability < 1.0) {
      if (Math.random() >= entry.probability) {
        scores.set(entry.id, 0);
        continue;
      }
    }

    scores.set(entry.id, 1.0);
  }

  return scores;
}
