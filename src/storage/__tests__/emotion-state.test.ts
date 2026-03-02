import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EmotionStateStore } from '../emotion-state.js';
import type { EmotionSnapshot } from '../../types/index.js';

describe('EmotionStateStore memory pools compatibility', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips memory_pools in emotion_state.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-emotion-store-'));
    dirs.push(dir);

    const store = new EmotionStateStore();
    const now = new Date().toISOString();
    const snapshot: EmotionSnapshot = {
      current: { joy: 0.5, sadness: 0.2, anger: 0.1, anxiety: 0.3, longing: 0.4, trust: 0.6 },
      baseline: { joy: 0.4, sadness: 0.2, anger: 0.1, anxiety: 0.3, longing: 0.3, trust: 0.5 },
      suppression: { count: 1, consecutive_hesitate: 0, accumulated: 1, last_suppress: null },
      memory_pools: { attachment_pool: 0.42, stress_pool: 0.31 },
      custom_state: { hello_kitty: 0.8, homesick: -0.2 },
      last_interaction: now,
      session_start: now,
    };

    const ok = store.write(dir, snapshot);
    expect(ok).toBe(true);

    const loaded = store.read(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.memory_pools).toEqual({
      attachment_pool: 0.42,
      stress_pool: 0.31,
    });
    expect(loaded!.custom_state).toEqual({
      hello_kitty: 0.8,
      homesick: -0.2,
    });
  });

  it('defaults memory_pools when reading legacy emotion_state.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-emotion-legacy-'));
    dirs.push(dir);

    const legacy = `# Emotion State

## Current
- joy: 0.500
- sadness: 0.200
- anger: 0.100
- anxiety: 0.300
- longing: 0.400
- trust: 0.600

## Baseline
- joy: 0.500
- sadness: 0.200
- anger: 0.100
- anxiety: 0.300
- longing: 0.400
- trust: 0.600

## Suppression
- count: 0
- consecutive_hesitate: 0
- accumulated: 0.000
- last_suppress: null

## Meta
- last_interaction: 2026-03-02T00:00:00.000Z
- session_start: 2026-03-02T00:00:00.000Z

## Directive History
- entries:

## Banned Word Streak
- data: {}
`;
    fs.writeFileSync(path.join(dir, 'emotion_state.md'), legacy, 'utf-8');

    const store = new EmotionStateStore();
    const loaded = store.read(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.memory_pools).toEqual({
      attachment_pool: 0,
      stress_pool: 0,
    });
    expect(loaded!.custom_state).toEqual({});
  });
});
