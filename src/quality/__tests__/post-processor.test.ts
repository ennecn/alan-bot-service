import { describe, it, expect } from 'vitest';
import { scanForBannedWords, sanitizeS1Output } from '../post-processor.js';

// ================================================================
// scanForBannedWords
// ================================================================

describe('scanForBannedWords', () => {
  // ── Clean text (no hits) ─────────────────────────────────────

  it('returns hitCount 0 on clean zh text', () => {
    const result = scanForBannedWords('她安静地喝着茶，窗外下着小雨。', 'zh', {});
    expect(result.hitCount).toBe(0);
    expect(result.wordsFound).toEqual([]);
    expect(result.reinforcement).toBeNull();
  });

  it('returns hitCount 0 on clean en text', () => {
    const result = scanForBannedWords(
      'She set her glass down and looked out the window.',
      'en',
      {},
    );
    expect(result.hitCount).toBe(0);
    expect(result.wordsFound).toEqual([]);
    expect(result.reinforcement).toBeNull();
  });

  it('returns hitCount 0 on clean ja text', () => {
    const result = scanForBannedWords('彼女は静かにお茶を飲んでいた。', 'ja', {});
    expect(result.hitCount).toBe(0);
    expect(result.wordsFound).toEqual([]);
    expect(result.reinforcement).toBeNull();
  });

  // ── Detection ────────────────────────────────────────────────

  it('detects banned word in zh text', () => {
    const result = scanForBannedWords('一阵复杂的情绪心中涌起，让她说不出话来。', 'zh', {});
    expect(result.hitCount).toBeGreaterThan(0);
    expect(result.wordsFound).toContain('心中涌起');
  });

  it('detects banned phrase in en text', () => {
    const result = scanForBannedWords(
      'A shiver ran down her spine as the door opened.',
      'en',
      {},
    );
    expect(result.hitCount).toBeGreaterThan(0);
    expect(result.wordsFound).toContain('a shiver ran down');
  });

  it('detects banned phrase in ja text', () => {
    const result = scanForBannedWords(
      '言い表せない何かが胸に広がった。',
      'ja',
      {},
    );
    expect(result.hitCount).toBeGreaterThan(0);
    expect(result.wordsFound).toContain('言い表せない何か');
  });

  it('detects multiple banned words in one text', () => {
    const result = scanForBannedWords(
      '心中涌起某种难以言表的感觉，一阵热流涌上心头。',
      'zh',
      {},
    );
    // Should find at least "心中涌起", "某种难以言表的", "涌上心头", "某种"
    expect(result.hitCount).toBeGreaterThanOrEqual(3);
    expect(result.wordsFound).toContain('心中涌起');
    expect(result.wordsFound).toContain('涌上心头');
  });

  it('en detection is case-insensitive', () => {
    const result = scanForBannedWords(
      'TIME SEEMED TO STOP as they locked eyes.',
      'en',
      {},
    );
    expect(result.wordsFound).toContain('time seemed to stop');
  });

  // ── Streak tracking ──────────────────────────────────────────

  it('first hit sets streak count to 1', () => {
    const result = scanForBannedWords('心中涌起一阵温暖。', 'zh', {});
    expect(result.updatedStreak['心中涌起']).toBe(1);
  });

  it('second consecutive hit increments streak to 2', () => {
    const result = scanForBannedWords('心中涌起一阵温暖。', 'zh', {
      '心中涌起': 1,
    });
    expect(result.updatedStreak['心中涌起']).toBe(2);
  });

  it('third consecutive hit (streak=3) triggers reinforcement', () => {
    const result = scanForBannedWords('心中涌起一阵温暖。', 'zh', {
      '心中涌起': 2,
    });
    expect(result.updatedStreak['心中涌起']).toBe(3);
    expect(result.reinforcement).not.toBeNull();
    expect(result.reinforcement).toContain('心中涌起');
  });

  it('no reinforcement below streak threshold', () => {
    const result = scanForBannedWords('心中涌起一阵温暖。', 'zh', {
      '心中涌起': 1,
    });
    expect(result.updatedStreak['心中涌起']).toBe(2);
    expect(result.reinforcement).toBeNull();
  });

  it('streak resets to 0 when word is not found', () => {
    const result = scanForBannedWords('她安静地喝着茶。', 'zh', {
      '心中涌起': 2,
    });
    expect(result.updatedStreak['心中涌起']).toBe(0);
  });

  it('updatedStreak contains entries for all absolute-ban words', () => {
    const result = scanForBannedWords('Clean text with no banned words.', 'en', {});
    // All absolute-ban words should have an entry (set to 0)
    for (const word of result.wordsFound) {
      expect(result.updatedStreak[word]).toBeGreaterThan(0);
    }
    // Every key in updatedStreak should be 0 since no hits
    for (const [, count] of Object.entries(result.updatedStreak)) {
      expect(count).toBe(0);
    }
  });

  // ── Reinforcement language check ─────────────────────────────

  it('zh reinforcement text is in Chinese', () => {
    const result = scanForBannedWords('心中涌起一阵温暖。', 'zh', {
      '心中涌起': 2,
    });
    expect(result.reinforcement).not.toBeNull();
    expect(result.reinforcement).toContain('注意');
    expect(result.reinforcement).toContain('连续');
    expect(result.reinforcement).toContain('禁止');
  });

  it('en reinforcement text is in English', () => {
    const result = scanForBannedWords(
      'Time seemed to stop when she looked up.',
      'en',
      { 'time seemed to stop': 2 },
    );
    expect(result.reinforcement).not.toBeNull();
    expect(result.reinforcement).toContain('CRITICAL');
    expect(result.reinforcement).toContain('banned');
    expect(result.reinforcement).toContain('consecutive');
  });

  it('ja reinforcement text is in Japanese', () => {
    const result = scanForBannedWords(
      '言い表せない何かが広がった。',
      'ja',
      { '言い表せない何か': 2 },
    );
    expect(result.reinforcement).not.toBeNull();
    expect(result.reinforcement).toContain('注意');
    expect(result.reinforcement).toContain('連続');
    expect(result.reinforcement).toContain('禁止');
  });
});

// ================================================================
// sanitizeS1Output
// ================================================================

describe('sanitizeS1Output', () => {
  // ── Clean text passes through ────────────────────────────────

  it('clean zh text passes through unchanged', () => {
    const input = '她安静地喝着茶，窗外下着小雨。';
    const { sanitized, replaced } = sanitizeS1Output(input, 'zh');
    expect(sanitized).toBe(input);
    expect(replaced).toBe(false);
  });

  it('clean en text passes through unchanged', () => {
    const input = 'She sat quietly, watching the rain fall.';
    const { sanitized, replaced } = sanitizeS1Output(input, 'en');
    expect(sanitized).toBe(input);
    expect(replaced).toBe(false);
  });

  it('clean ja text passes through unchanged', () => {
    const input = '彼女は窓の外を見つめていた。';
    const { sanitized, replaced } = sanitizeS1Output(input, 'ja');
    expect(sanitized).toBe(input);
    expect(replaced).toBe(false);
  });

  // ── Single banned word replacement ───────────────────────────

  it('replaces zh banned word with [...]', () => {
    const input = '一阵复杂的感情心中涌起。';
    const { sanitized, replaced } = sanitizeS1Output(input, 'zh');
    expect(replaced).toBe(true);
    expect(sanitized).not.toContain('心中涌起');
    expect(sanitized).toContain('[...]');
  });

  it('replaces en banned phrase with [...]', () => {
    const input = 'A shiver ran down her spine as the door creaked.';
    const { sanitized, replaced } = sanitizeS1Output(input, 'en');
    expect(replaced).toBe(true);
    expect(sanitized.toLowerCase()).not.toContain('a shiver ran down');
    expect(sanitized).toContain('[...]');
  });

  it('replaces ja banned phrase with [...]', () => {
    const input = '言い表せない何かが彼女の心に広がった。';
    const { sanitized, replaced } = sanitizeS1Output(input, 'ja');
    expect(replaced).toBe(true);
    expect(sanitized).not.toContain('言い表せない何か');
    expect(sanitized).toContain('[...]');
  });

  // ── Multiple banned words ────────────────────────────────────

  it('replaces multiple zh banned words', () => {
    const input = '心中涌起某种难以言表的情绪，涌上心头。';
    const { sanitized, replaced } = sanitizeS1Output(input, 'zh');
    expect(replaced).toBe(true);
    expect(sanitized).not.toContain('心中涌起');
    expect(sanitized).not.toContain('涌上心头');
    // Should have multiple [...] replacements
    const bracketCount = (sanitized.match(/\[\.\.\.\]/g) || []).length;
    expect(bracketCount).toBeGreaterThanOrEqual(2);
  });

  it('replaces multiple en banned phrases', () => {
    const input =
      'Time seemed to stop. Her orbs glistened with unshed tears.';
    const { sanitized, replaced } = sanitizeS1Output(input, 'en');
    expect(replaced).toBe(true);
    expect(sanitized.toLowerCase()).not.toContain('time seemed to stop');
    expect(sanitized.toLowerCase()).not.toContain('orbs');
    const bracketCount = (sanitized.match(/\[\.\.\.\]/g) || []).length;
    expect(bracketCount).toBeGreaterThanOrEqual(2);
  });

  // ── en case insensitivity ────────────────────────────────────

  it('en replacement is case-insensitive', () => {
    const input = 'THE AIR CRACKLED with tension.';
    const { sanitized, replaced } = sanitizeS1Output(input, 'en');
    expect(replaced).toBe(true);
    expect(sanitized.toLowerCase()).not.toContain('the air crackled');
    expect(sanitized).toContain('[...]');
  });

  // ── Cautious words NOT replaced ──────────────────────────────

  it('does not replace cautious-level zh words', () => {
    const input = '湖面上泛起涟漪。';
    const { sanitized, replaced } = sanitizeS1Output(input, 'zh');
    expect(sanitized).toBe(input);
    expect(replaced).toBe(false);
  });

  it('does not replace cautious-level en words', () => {
    const input = 'She suddenly turned around.';
    const { sanitized, replaced } = sanitizeS1Output(input, 'en');
    expect(sanitized).toBe(input);
    expect(replaced).toBe(false);
  });
});
