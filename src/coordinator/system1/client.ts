/**
 * System 1 — LLM client with tool_use parsing and degradation chain.
 * PRD v6.0 §3.2
 */

import type { System1Output, EmotionDimension, EventImportance } from '../../types/index.js';
import type { System1CallParams } from './types.js';
import { buildSystem1Prompt } from './prompt.js';
import { PROCESS_EVENT_TOOL } from './schema.js';

const VALID_IMPORTANCES = new Set([0.0, 0.3, 0.6, 1.0]);
const EMOTION_DIMENSIONS: EmotionDimension[] = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'];

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v));
}

function nearestImportance(v: number): EventImportance {
  let best: EventImportance = 0.0;
  let bestDist = Infinity;
  for (const imp of [0.0, 0.3, 0.6, 1.0] as EventImportance[]) {
    const dist = Math.abs(v - imp);
    if (dist < bestDist) { bestDist = dist; best = imp; }
  }
  return best;
}

/** Validate and clamp raw tool output into a clean System1Output. */
export function sanitizeOutput(raw: Record<string, unknown>): System1Output {
  const ec = (raw.event_classification ?? {}) as Record<string, unknown>;
  const rawImportance = typeof ec.importance === 'number' ? ec.importance : 0.0;

  const emotionalRaw = (raw.emotional_interpretation ?? {}) as Record<string, number>;
  const emotional: Partial<Record<EmotionDimension, number>> = {};
  for (const d of EMOTION_DIMENSIONS) {
    if (typeof emotionalRaw[d] === 'number') {
      emotional[d] = clamp(-0.3, 0.3, emotionalRaw[d]);
    }
  }

  const mc = (raw.memory_consolidation ?? {}) as Record<string, unknown>;

  return {
    event_classification: {
      type: typeof ec.type === 'string' ? ec.type : 'system',
      importance: VALID_IMPORTANCES.has(rawImportance) ? rawImportance as EventImportance : nearestImportance(rawImportance),
    },
    emotional_interpretation: emotional,
    cognitive_projection: typeof raw.cognitive_projection === 'string' ? raw.cognitive_projection : '',
    wi_expansion: Array.isArray(raw.wi_expansion) ? raw.wi_expansion.filter((x): x is string => typeof x === 'string') : [],
    impulse_narrative: typeof raw.impulse_narrative === 'string' ? raw.impulse_narrative : '',
    memory_consolidation: {
      should_save: typeof mc.should_save === 'boolean' ? mc.should_save : false,
      summary: typeof mc.summary === 'string' ? mc.summary : '',
    },
  };
}

/** Try to extract JSON from text output via regex (degradation path b). */
function tryRegexParse(text: string): Record<string, unknown> | null {
  // Look for JSON object in the text
  const match = text.match(/\{[\s\S]*"event_classification"[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface System1Config {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/**
 * Call System 1 LLM with tool_use and parse the response.
 *
 * Degradation chain:
 *   a. tool_use response → parse directly
 *   b. tool_use fails → try regex parsing from text
 *   c. regex fails → return null
 */
export async function callSystem1(
  params: System1CallParams,
  config: System1Config,
): Promise<System1Output | null> {
  try {
  const promptParams = { ...params, previousImpulse: params.oldImpulse ?? params.previousImpulse };
  const { system, messages } = buildSystem1Prompt(promptParams);

  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;

  const body = {
    model: config.model,
    max_tokens: 2048,
    system,
    messages,
    tools: [PROCESS_EVENT_TOOL],
    tool_choice: { type: 'auto' },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }>;
  };

  if (!data.content || !Array.isArray(data.content)) return null;

  // Path a: look for tool_use block
  const toolBlock = data.content.find(b => b.type === 'tool_use' && b.name === 'process_event');
  if (toolBlock?.input) {
    return sanitizeOutput(toolBlock.input);
  }

  // Path b: try regex from text blocks
  const textContent = data.content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('\n');

  if (textContent) {
    const parsed = tryRegexParse(textContent);
    if (parsed) return sanitizeOutput(parsed);
  }

  // Path c: total failure
  return null;
  } catch {
    return null;
  }
}
