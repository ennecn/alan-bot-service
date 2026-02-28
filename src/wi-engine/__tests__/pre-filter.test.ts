import { describe, it, expect } from 'vitest';
import { preFilter } from '../pre-filter.js';
import { combineSignals } from '../combiner.js';
import { cosineSimilarity } from '../semantic-scorer.js';
import { activateEntries } from '../activation.js';
import type { WIEntry, WISignalWeights } from '../../types/actions.js';
import { DEFAULT_WI_WEIGHTS } from '../../types/actions.js';

function makeEntry(id: string, keys: string[], extra: Partial<WIEntry> = {}): WIEntry {
  return { id, keys, content: `Content for ${id}`, enabled: true, ...extra };
}

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors (normalized to [0,1])', () => {
    // cos([1,0],[1,0]) = 1 → normalized = (1+1)/2 = 1.0
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0, 4);
  });

  it('returns 0.5 for orthogonal vectors', () => {
    // cos([1,0],[0,1]) = 0 → normalized = (0+1)/2 = 0.5
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.5, 4);
  });

  it('returns 0.0 for opposite vectors', () => {
    // cos([1,0],[-1,0]) = -1 → normalized = (-1+1)/2 = 0.0
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(0.0, 4);
  });

  it('returns 0 for zero-length vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('preFilter', () => {
  it('returns entries matching text keywords', () => {
    const entries = [
      makeEntry('e1', ['dragon']),
      makeEntry('e2', ['castle']),
      makeEntry('e3', ['sword']),
    ];
    const result = preFilter('the dragon attacked', null, entries, DEFAULT_WI_WEIGHTS);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('returns top-K entries sorted by score', () => {
    // Create 60 entries, all matching
    const entries = Array.from({ length: 60 }, (_, i) =>
      makeEntry(`e${i}`, ['match'], { constant: true }),
    );
    const result = preFilter('match', null, entries, DEFAULT_WI_WEIGHTS);
    expect(result).toHaveLength(50); // top-K = 50
  });

  it('uses semantic scores when embedding is available', () => {
    const embedding = [1, 0, 0];
    const entries = [
      makeEntry('e1', ['nomatch'], { embedding: [1, 0, 0] }), // high semantic, no text match
      makeEntry('e2', ['hello'], { embedding: [-1, 0, 0] }),   // text match, low semantic
    ];
    const result = preFilter('hello world', embedding, entries, DEFAULT_WI_WEIGHTS);
    // e2 matches text (score 1.0), e1 has high semantic but no text match
    // With weights normalized: text=0.4/(0.4+0.3)=0.571, semantic=0.429
    // e1: 0*0.571 + 1.0*0.429 = 0.429
    // e2: 1.0*0.571 + 0.0*0.429 = 0.571
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].id).toBe('e2'); // text match wins with default weights
  });

  it('redistributes semantic weight when no embedding', () => {
    const entries = [makeEntry('e1', ['dragon'])];
    const result = preFilter('dragon', null, entries, DEFAULT_WI_WEIGHTS);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });
});

describe('combineSignals', () => {
  it('computes weighted sum with default weights', () => {
    const score = combineSignals(
      { text: 1.0, semantic: 0.5, state: 0.0, temporal: 0.0 },
      DEFAULT_WI_WEIGHTS,
    );
    // Pure ST: redistribute state(0.2)+temporal(0.1) to text+semantic
    // wText = 0.4 + 0.3*(0.4/0.7) = 0.4 + 0.171 = 0.571
    // wSemantic = 0.3 + 0.3*(0.3/0.7) = 0.3 + 0.129 = 0.429
    // combined = 0.571*1.0 + 0.429*0.5 = 0.571 + 0.214 = 0.786
    expect(score).toBeCloseTo(0.786, 2);
  });

  it('uses all 4 weights when state/temporal are non-zero', () => {
    const score = combineSignals(
      { text: 1.0, semantic: 1.0, state: 1.0, temporal: 1.0 },
      DEFAULT_WI_WEIGHTS,
    );
    // 0.4 + 0.3 + 0.2 + 0.1 = 1.0
    expect(score).toBeCloseTo(1.0, 4);
  });

  it('clamps result to [0, 1]', () => {
    const score = combineSignals(
      { text: 1.0, semantic: 1.0, state: 1.0, temporal: 1.0 },
      { text_scanner: 0.5, semantic_scorer: 0.5, state_evaluator: 0.5, temporal_evaluator: 0.5 },
    );
    expect(score).toBe(1.0);
  });
});

describe('activateEntries', () => {
  it('filters entries below threshold', () => {
    const entries = [makeEntry('e1', ['a']), makeEntry('e2', ['b'])];
    const scores = new Map([['e1', 0.8], ['e2', 0.3]]);
    const result = activateEntries(entries, scores, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('respects group mutual exclusion', () => {
    const entries = [
      makeEntry('e1', ['a'], { group: 'grp1', order: 1 }),
      makeEntry('e2', ['b'], { group: 'grp1', order: 2 }),
    ];
    const scores = new Map([['e1', 0.8], ['e2', 0.9]]);
    const result = activateEntries(entries, scores, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1'); // lower order wins
  });

  it('skips entries in cooldown', () => {
    const entries = [makeEntry('e1', ['a'])];
    const scores = new Map([['e1', 0.8]]);
    const cooldownCounters = new Map([['e1', 3]]);
    const result = activateEntries(entries, scores, 0.5, { cooldownCounters });
    expect(result).toHaveLength(0);
  });

  it('skips entries before delay turn', () => {
    const entries = [makeEntry('e1', ['a'], { delay: 5 })];
    const scores = new Map([['e1', 0.8]]);
    const result = activateEntries(entries, scores, 0.5, { turnCount: 3 });
    expect(result).toHaveLength(0);
  });

  it('keeps sticky entries even below threshold', () => {
    const entries = [makeEntry('e1', ['a'], { sticky: 3 })];
    const scores = new Map([['e1', 0.2]]); // below threshold
    const stickyCounters = new Map([['e1', 2]]);
    const result = activateEntries(entries, scores, 0.5, { stickyCounters });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('sorts by order ascending, then weight descending', () => {
    const entries = [
      makeEntry('e1', ['a'], { order: 2, weight: 10 }),
      makeEntry('e2', ['b'], { order: 1, weight: 5 }),
      makeEntry('e3', ['c'], { order: 1, weight: 20 }),
    ];
    const scores = new Map([['e1', 0.8], ['e2', 0.8], ['e3', 0.8]]);
    const result = activateEntries(entries, scores, 0.5);
    expect(result.map(e => e.id)).toEqual(['e3', 'e2', 'e1']);
  });
});
