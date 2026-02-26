/**
 * EmotionStateStore — read/write EmotionSnapshot as emotion_state.md (Markdown).
 * NOT backed by SQLite. Parse defense: returns null on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EmotionSnapshot, EmotionState, SuppressionFatigue } from '../types/index.js';

const FILENAME = 'emotion_state.md';

const EMOTION_DIMS = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'] as const;

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
    return true;
  }
}

function serializeEmotionMd(s: EmotionSnapshot): string {
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
    '## Meta',
    `- last_interaction: ${s.last_interaction}`,
    `- session_start: ${s.session_start}`,
    '',
  ];
  return lines.join('\n');
}

function parseEmotionMd(content: string): EmotionSnapshot | null {
  try {
    const current = parseSection(content, 'Current');
    const baseline = parseSection(content, 'Baseline');
    const suppression = parseSuppressionSection(content);
    const meta = parseMetaSection(content);
    if (!current || !baseline || !suppression || !meta) return null;
    return { current, baseline, suppression, ...meta };
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

function parseMetaSection(content: string): { last_interaction: string; session_start: string } | null {
  const regex = /## Meta\n([\s\S]*?)(?=\n##|$)/;
  const match = content.match(regex);
  if (!match) return null;

  const liMatch = match[1].match(/- last_interaction:\s*(.+)/);
  const ssMatch = match[1].match(/- session_start:\s*(.+)/);
  if (!liMatch || !ssMatch) return null;

  return { last_interaction: liMatch[1].trim(), session_start: ssMatch[1].trim() };
}

function extractNum(block: string, key: string): number | null {
  const m = block.match(new RegExp(`- ${key}:\\s*([\\d.+-]+)`));
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : v;
}
