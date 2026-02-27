/**
 * SillyTavern Preset Parser
 *
 * Resolves prompt_order, classifies blocks into pre-chat / post-chat / depth injections,
 * extracts sampler params with boundary clamping.
 */

import type {
  STPresetRaw,
  STPromptBlock,
  STPromptOrderEntry,
  AlanPreset,
  SamplerParams,
  DepthInjection,
} from './types.js';

/** Well-known ST marker identifiers that Alan handles natively — skip these. */
const MARKER_IDENTIFIERS = new Set([
  'charDescription',
  'charPersonality',
  'scenario',
  'dialogueExamples',
  'worldInfoBefore',
  'worldInfoAfter',
  'personaDescription',
  'chatHistory',
]);

const CHAT_HISTORY_ID = 'chatHistory';

// ── Sampler Extraction ──

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function extractSampler(raw: STPresetRaw): SamplerParams {
  const sampler: SamplerParams = {};
  if (raw.temperature !== undefined) sampler.temperature = clamp(raw.temperature, 0, 2);
  if (raw.top_p !== undefined) sampler.top_p = clamp(raw.top_p, 0, 1);
  if (raw.top_k !== undefined) sampler.top_k = clamp(Math.round(raw.top_k), 0, 200);
  if (raw.frequency_penalty !== undefined) sampler.frequency_penalty = clamp(raw.frequency_penalty, 0, 2);
  if (raw.presence_penalty !== undefined) sampler.presence_penalty = clamp(raw.presence_penalty, 0, 2);
  return sampler;
}

// ── Prompt Order Resolution ──

function resolvePromptOrder(raw: STPresetRaw): STPromptOrderEntry[] {
  if (!raw.prompt_order?.length) return [];

  // Prefer character_id 100000 (default), fallback to first entry
  const entry = raw.prompt_order.find(e => e.character_id === 100000)
    ?? raw.prompt_order[0];
  return entry.order ?? [];
}

function buildBlockMap(prompts: STPromptBlock[]): Map<string, STPromptBlock> {
  const map = new Map<string, STPromptBlock>();
  for (const block of prompts) {
    map.set(block.identifier, block);
  }
  return map;
}

// ── Block Classification ──

export interface ParseResult {
  sampler: SamplerParams;
  systemPrefix: string;
  postHistory: string;
  depthInjections: DepthInjection[];
  assistantPrefill?: string;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  rawPromptOrder: STPromptOrderEntry[];
}

export function parsePreset(raw: STPresetRaw): ParseResult {
  const sampler = extractSampler(raw);
  const order = resolvePromptOrder(raw);
  const blockMap = buildBlockMap(raw.prompts ?? []);

  // Find chatHistory split point
  const chatHistoryIdx = order.findIndex(e => e.identifier === CHAT_HISTORY_ID);

  const preChatBlocks: string[] = [];
  const postChatBlocks: string[] = [];
  const depthInjections: DepthInjection[] = [];
  let assistantPrefill: string | undefined;

  for (let i = 0; i < order.length; i++) {
    const entry = order[i];
    if (!entry.enabled) continue;

    // Skip well-known markers
    if (MARKER_IDENTIFIERS.has(entry.identifier)) continue;

    const block = blockMap.get(entry.identifier);
    if (!block) continue;
    if (!block.enabled) continue;
    if (block.marker) continue;
    if (!block.content?.trim()) continue;

    // Depth injections (injection_position === 1) go to separate list
    if (block.injection_position === 1) {
      depthInjections.push({
        content: block.content,
        depth: block.injection_depth,
        role: block.role,
        order: block.injection_order,
      });
      continue;
    }

    const isPostChat = chatHistoryIdx >= 0 && i > chatHistoryIdx;

    if (isPostChat) {
      // Track last assistant block after chatHistory as potential prefill
      if (block.role === 'assistant') {
        assistantPrefill = block.content;
      } else {
        postChatBlocks.push(block.content);
      }
    } else {
      preChatBlocks.push(block.content);
    }
  }

  // Also check blocks not in prompt_order but with depth injection
  for (const block of raw.prompts ?? []) {
    if (!block.enabled || block.marker || !block.content?.trim()) continue;
    if (block.injection_position !== 1) continue;
    // Only add if not already captured by order walk
    const alreadyCaptured = depthInjections.some(d =>
      d.content === block.content && d.depth === block.injection_depth,
    );
    if (!alreadyCaptured) {
      depthInjections.push({
        content: block.content,
        depth: block.injection_depth,
        role: block.role,
        order: block.injection_order,
      });
    }
  }

  // Sort depth injections: depth ASC, then order DESC (ST convention)
  depthInjections.sort((a, b) => a.depth - b.depth || b.order - a.order);

  return {
    sampler,
    systemPrefix: preChatBlocks.join('\n\n'),
    postHistory: postChatBlocks.join('\n\n'),
    depthInjections,
    assistantPrefill,
    maxContextTokens: raw.openai_max_context ?? undefined,
    maxOutputTokens: raw.openai_max_tokens ?? undefined,
    rawPromptOrder: order,
  };
}
