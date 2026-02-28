/**
 * SillyTavern Preset Import — Orchestrator
 *
 * Reads an ST preset JSON file, parses and classifies blocks,
 * writes Alan-native preset.json to workspace/internal/.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { STPresetRaw, AlanPreset } from './types.js';
import { parsePreset } from './parser.js';

const PRESET_WARN_TOKENS = 8_000; // ~32K chars

/**
 * Import an ST preset JSON file into an Alan workspace.
 * Returns the parsed AlanPreset (also written to disk).
 */
export function importPreset(presetPath: string, workspacePath: string): AlanPreset {
  // 1. Read and parse
  const raw = JSON.parse(fs.readFileSync(presetPath, 'utf-8')) as STPresetRaw;

  // 2. Parse and classify
  const parsed = parsePreset(raw);

  // 3. Build AlanPreset
  const preset: AlanPreset = {
    source_name: path.basename(presetPath, '.json'),
    imported_at: new Date().toISOString(),
    sampler: parsed.sampler,
    system_prefix: parsed.systemPrefix,
    post_history: parsed.postHistory,
    depth_injections: parsed.depthInjections,
    assistant_prefill: parsed.assistantPrefill,
    max_context_tokens: parsed.maxContextTokens,
    max_output_tokens: parsed.maxOutputTokens,
    raw_prompt_order: parsed.rawPromptOrder,
  };

  // 4. Warn on large presets
  const totalChars = preset.system_prefix.length + preset.post_history.length
    + preset.depth_injections.reduce((sum, d) => sum + d.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  if (estimatedTokens > PRESET_WARN_TOKENS) {
    console.warn(
      `[preset-import] Large preset detected (~${estimatedTokens} tokens). ` +
      `system_prefix will be capped at 4K tokens during assembly.`,
    );
  }

  // 5. Write to workspace
  const internalDir = path.join(workspacePath, 'internal');
  fs.mkdirSync(internalDir, { recursive: true });
  fs.writeFileSync(
    path.join(internalDir, 'preset.json'),
    JSON.stringify(preset, null, 2),
    'utf-8',
  );

  return preset;
}

export { parsePreset } from './parser.js';
export { expandMacros } from './macros.js';
export type { AlanPreset, SamplerParams, DepthInjection, STPresetRaw } from './types.js';
