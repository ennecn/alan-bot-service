/**
 * Prompt Assembler — 4-layer prompt construction for System 2.
 * PRD v6.0 §3.3
 *
 * Token estimation: string.length / 4 (Phase 0 approximation).
 */

import type { WIEntry } from '../types/actions.js';

export interface AssemblyParams {
  systemPrompt: string;
  soulMd: string;
  mesExample: string;
  constantWI: WIEntry[];
  impulseMd: string;
  emotionNarrative: string;
  activatedWI: WIEntry[];
  chatHistory: Array<{ role: string; content: string }>;
  postHistoryInstructions: string;
  maxContextTokens?: number;
  outputReserve?: number;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Token budget defaults
const L1_BUDGET = 4_000;
const L2_BUDGET = 8_000;
const L3_BUDGET_MIN = 8_000;
const L3_BUDGET_MAX = 16_000;
const OUTPUT_RESERVE = 4_000;
const MES_EXAMPLE_LIMIT = 3_000;
const DEFAULT_MAX_CONTEXT = 128_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/**
 * Truncate mes_example: keep first N complete <START> blocks within token limit.
 */
function truncateMesExample(mesExample: string, maxTokens: number): string {
  if (!mesExample) return '';
  const blocks = mesExample.split('<START>');
  const kept: string[] = [];
  let tokens = 0;

  for (const block of blocks) {
    if (!block.trim()) continue;
    const candidate = '<START>' + block;
    const blockTokens = estimateTokens(candidate);
    if (tokens + blockTokens > maxTokens) break;
    kept.push(candidate);
    tokens += blockTokens;
  }

  return kept.join('');
}

function formatWIEntries(entries: WIEntry[]): string {
  if (entries.length === 0) return '';
  return entries.map((e) => `[WI: ${e.keys.join(', ')}]\n${e.content}`).join('\n\n');
}

export function assemble(params: AssemblyParams): { system: string; messages: AnthropicMessage[] } {
  const maxContext = params.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  const outputReserve = params.outputReserve ?? OUTPUT_RESERVE;

  // L1: system_prompt (truncate to budget)
  const l1 = truncateToTokens(params.systemPrompt, L1_BUDGET);

  // L2: SOUL.md + mes_example + constant WI
  const mesExTruncated = truncateMesExample(params.mesExample, MES_EXAMPLE_LIMIT);
  const constantWIText = formatWIEntries(params.constantWI);
  const l2Parts = [params.soulMd, mesExTruncated, constantWIText].filter(Boolean);
  const l2 = truncateToTokens(l2Parts.join('\n\n'), L2_BUDGET);

  // L3: IMPULSE.md + emotion narrative + activated WI
  const activatedWIText = formatWIEntries(params.activatedWI);
  const l3Parts = [params.impulseMd, params.emotionNarrative, activatedWIText].filter(Boolean);
  const l3Budget = Math.min(L3_BUDGET_MAX, Math.max(L3_BUDGET_MIN, estimateTokens(l3Parts.join('\n\n'))));
  const l3 = truncateToTokens(l3Parts.join('\n\n'), l3Budget);

  // System prompt = L1 + L2 + L3
  const system = [l1, l2, l3].filter(Boolean).join('\n\n---\n\n');

  // L4: chat history + post_history_instructions (remainder budget)
  const usedTokens = estimateTokens(system) + outputReserve;
  const l4Budget = maxContext - usedTokens;

  // Build messages from chat history, newest first, truncate to budget
  const messages: AnthropicMessage[] = [];
  let l4Tokens = 0;

  if (params.postHistoryInstructions) {
    const phiTokens = estimateTokens(params.postHistoryInstructions);
    l4Tokens += phiTokens;
  }

  // Add chat history from oldest to newest, but respect budget
  const historyToInclude: Array<{ role: string; content: string }> = [];
  for (let i = params.chatHistory.length - 1; i >= 0; i--) {
    const msg = params.chatHistory[i];
    const msgTokens = estimateTokens(msg.content);
    if (l4Tokens + msgTokens > l4Budget) break;
    historyToInclude.unshift(msg);
    l4Tokens += msgTokens;
  }

  for (const msg of historyToInclude) {
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  // Append post_history_instructions as final user message
  if (params.postHistoryInstructions) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      last.content += '\n\n' + params.postHistoryInstructions;
    } else {
      messages.push({ role: 'user', content: params.postHistoryInstructions });
    }
  }

  return { system, messages };
}
