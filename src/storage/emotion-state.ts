/**
 * EmotionStateStore — read/write EmotionSnapshot as emotion_state.md (Markdown).
 * NOT backed by SQLite. Parse defense: returns null on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EmotionSnapshot, EmotionState, SuppressionFatigue, MemoryPools } from '../types/index.js';

const FILENAME = 'emotion_state.md';

const EMOTION_DIMS = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'] as const;
const DEFAULT_MEMORY_POOLS: MemoryPools = {
  attachment_pool: 0,
  stress_pool: 0,
};

export class EmotionStateStore {
  /** Read and parse emotion_state.md. Returns null if file missing or parse fails. */
  read(workspacePath: string): EmotionSnapshot | null {
    const filePath = path.join(workspacePath, FILENAME);
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf-8');
      return parseEmotionMd(content);
    } catch {
      return null;
    }
  }

  /** Write snapshot to emotion_state.md, then read-back verify. */
  write(workspacePath: string, snapshot: EmotionSnapshot): boolean {
    const filePath = path.join(workspacePath, FILENAME);
    const md = serializeEmotionMd(snapshot);
    fs.writeFileSync(filePath, md, 'utf-8');

    // Read-back verify
    const verified = this.read(workspacePath);
    if (!verified) return false;

    for (const dim of EMOTION_DIMS) {
      if (Math.abs(verified.current[dim] - snapshot.current[dim]) > 0.001) return false;
    }
    const expectedPools = snapshot.memory_pools ?? DEFAULT_MEMORY_POOLS;
    const actualPools = verified.memory_pools ?? DEFAULT_MEMORY_POOLS;
    if (Math.abs(actualPools.attachment_pool - expectedPools.attachment_pool) > 0.001) return false;
    if (Math.abs(actualPools.stress_pool - expectedPools.stress_pool) > 0.001) return false;
    const expectedCustom = snapshot.custom_state ?? {};
    const actualCustom = verified.custom_state ?? {};
    if (Object.keys(expectedCustom).length !== Object.keys(actualCustom).length) return false;
    for (const [key, value] of Object.entries(expectedCustom)) {
      if (Math.abs((actualCustom[key] ?? 0) - value) > 0.001) return false;
    }
    if ((verified.directive_history?.length ?? 0) !== (snapshot.directive_history?.length ?? 0)) return false;
    const origStreakKeys = Object.keys(snapshot.banned_word_streak ?? {}).length;
    const verifiedStreakKeys = Object.keys(verified.banned_word_streak ?? {}).length;
    if (origStreakKeys !== verifiedStreakKeys) return false;
    return true;
  }
}

function serializeEmotionMd(s: EmotionSnapshot): string {
  const pools = s.memory_pools ?? DEFAULT_MEMORY_POOLS;
  const customEntries = Object.entries(s.custom_state ?? {});
  const lines: string[] = [
    '# Emotion State',
    '',
    '## Current',
    ...EMOTION_DIMS.map((d) => `- ${d}: ${s.current[d].toFixed(3)}`),
    '',
    '## Baseline',
    ...EMOTION_DIMS.map((d) => `- ${d}: ${s.baseline[d].toFixed(3)}`),
    '',
    '## Suppression',
    `- count: ${s.suppression.count}`,
    `- consecutive_hesitate: ${s.suppression.consecutive_hesitate}`,
    `- accumulated: ${s.suppression.accumulated.toFixed(3)}`,
    `- last_suppress: ${s.suppression.last_suppress ?? 'null'}`,
    '',
    '## Memory Pools',
    `- attachment_pool: ${pools.attachment_pool.toFixed(3)}`,
    `- stress_pool: ${pools.stress_pool.toFixed(3)}`,
    '',
    '## Custom State',
    `- data: ${JSON.stringify(Object.fromEntries(customEntries.map(([k, v]) => [k, Number(v.toFixed(3))])))}`,
    '',
    '## Meta',
    `- last_interaction: ${s.last_interaction}`,
    `- session_start: ${s.session_start}`,
    '',
    '## Directive History',
    `- entries: ${(s.directive_history ?? []).slice(-3).join(',')}`,
    '',
    '## Banned Word Streak',
    `- data: ${JSON.stringify(s.banned_word_streak ?? {})}`,
    '',
  ];
  return lines.join('\n');
}

function parseEmotionMd(content: string): EmotionSnapshot | null {
  try {
    const current = parseSection(content, 'Current');
    const baseline = parseSection(content, 'Baseline');
    const suppression = parseSuppressionSection(content);
    const memoryPools = parseMemoryPoolsSection(content);
    const customState = parseCustomStateSection(content);
    const meta = parseMetaSection(content);
    if (!current || !baseline || !suppression || !meta) return null;
    const directiveHistory = parseDirectiveHistorySection(content);
    const bannedWordStreak = parseBannedWordStreakSection(content);
    return {
      current,
      baseline,
      suppression,
      memory_pools: memoryPools ?? DEFAULT_MEMORY_POOLS,
      custom_state: customState,
      ...meta,
      directive_history: directiveHistory,
      banned_word_streak: bannedWordStreak,
    };
  } catch {
    return null;
  }
}

function parseSection(content: string, heading: string): EmotionState | null {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n##|$)`);
  const match = content.match(regex);
  if (!match) return null;

  const state: Partial<EmotionState> = {};
  for (const dim of EMOTION_DIMS) {
    const lineMatch = match[1].match(new RegExp(`- ${dim}:\\s*([\\d.+-]+)`));
    if (!lineMatch) return null;
    state[dim] = parseFloat(lineMatch[1]);
    if (isNaN(state[dim]!)) return null;
  }
  return state as EmotionState;
}

function parseSuppressionSection(content: string): SuppressionFatigue | null {
  const regex = /## Suppression\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return null;

  const block = match[1];
  const count = extractNum(block, 'count');
  const consec = extractNum(block, 'consecutive_hesitate');
  const accum = extractNum(block, 'accumulated');
  if (count === null || consec === null || accum === null) return null;

  const lastMatch = block.match(/- last_suppress:\s*(.+)/);
  const lastSuppress = lastMatch?.[1].trim() === 'null' ? null : lastMatch?.[1].trim() ?? null;

  return { count, consecutive_hesitate: consec, accumulated: accum, last_suppress: lastSuppress };
}

function parseMemoryPoolsSection(content: string): MemoryPools | null {
  const regex = /## Memory Pools\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return null;

  const block = match[1];
  const attachment = extractNum(block, 'attachment_pool');
  const stress = extractNum(block, 'stress_pool');
  if (attachment === null || stress === null) return null;

  return {
    attachment_pool: attachment,
    stress_pool: stress,
  };
}

function parseMetaSection(content: string): { last_interaction: string; session_start: string } | null {
  const regex = /## Meta\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return null;

  const liMatch = match[1].match(/- last_interaction:\s*(.+)/);
  const ssMatch = match[1].match(/- session_start:\s*(.+)/);
  if (!liMatch || !ssMatch) return null;

  return { last_interaction: liMatch[1].trim(), session_start: ssMatch[1].trim() };
}

function parseCustomStateSection(content: string): Record<string, number> {
  const regex = /## Custom State\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return {};
  const dataMatch = match[1].match(/- data:\s*(.*)/);
  if (!dataMatch) return {};

  try {
    const parsed = JSON.parse(dataMatch[1].trim()) as Record<string, unknown>;
    const clean: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'number') continue;
      if (key.length === 0 || key.length > 64) continue;
      clean[key] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

function parseDirectiveHistorySection(content: string): string[] {
  const regex = /## Directive History\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return []; // lenient — missing section = empty array
  const entriesMatch = match[1].match(/- entries:\s*(.*)/);
  if (!entriesMatch) return [];
  return entriesMatch[1].trim().split(',').filter(Boolean);
}

function parseBannedWordStreakSection(content: string): Record<string, number> {
  const regex = /## Banned Word Streak\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return {};
  const dataMatch = match[1].match(/- data:\s*(.*)/);
  if (!dataMatch) return {};
  try {
    return JSON.parse(dataMatch[1].trim()) as Record<string, number>;
  } catch {
    return {};
  }
}

function extractNum(block: string, key: string): number | null {
  const m = block.match(new RegExp(`- ${key}:\\s*([\\d.+-]+)`));
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : v;
}
