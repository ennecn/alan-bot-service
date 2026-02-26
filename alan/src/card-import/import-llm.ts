/**
 * Import LLM — calls LLM with character identity to generate initial
 * IMPULSE.md, emotion baselines, and SOUL.md for a newly imported card.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AlanConfig } from '../types/actions.js';
import type { EmotionDimension } from '../types/index.js';
import type { CardData } from './mapper.js';

const GENERATE_CHARACTER_INIT_TOOL = {
  name: 'generate_character_init',
  description: 'Generate initial character behavioral data from their identity and prompt.',
  input_schema: {
    type: 'object' as const,
    required: ['impulse_narrative', 'emotion_baseline', 'soul_description'],
    properties: {
      impulse_narrative: {
        type: 'string',
        description: 'A short first-person internal monologue for IMPULSE.md reflecting the character\'s initial state before any interaction. Written in the character\'s language.',
      },
      emotion_baseline: {
        type: 'object',
        description: 'Baseline emotion values (0.0-1.0) for each dimension, calibrated to the character personality.',
        properties: {
          joy: { type: 'number', minimum: 0, maximum: 1 },
          sadness: { type: 'number', minimum: 0, maximum: 1 },
          anger: { type: 'number', minimum: 0, maximum: 1 },
          anxiety: { type: 'number', minimum: 0, maximum: 1 },
          longing: { type: 'number', minimum: 0, maximum: 1 },
          trust: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      soul_description: {
        type: 'string',
        description: 'A brief behavioral guide (SOUL.md) describing how this character should behave, react, and speak. Written in English.',
      },
    },
  },
};

export interface ImportLLMResult {
  impulse_narrative: string;
  emotion_baseline: Partial<Record<EmotionDimension, number>>;
  soul_description: string;
}

/**
 * Call Import LLM to generate initial character data.
 * Reads card-data.json for the character identity.
 * Writes IMPULSE.md and SOUL.md to workspace.
 */
export async function callImportLLM(
  config: AlanConfig,
  workspacePath: string,
): Promise<ImportLLMResult | null> {
  const baseUrl = config.import_llm_base_url ?? config.system1_base_url;
  const model = config.import_llm_model ?? config.system1_model;
  const apiKey = config.import_llm_api_key ?? config.s1_api_key;

  // Read card-data.json for character context
  const cardDataPath = path.join(workspacePath, 'internal', 'card-data.json');
  if (!fs.existsSync(cardDataPath)) {
    console.error('[import-llm] card-data.json not found — run card import first');
    return null;
  }

  const cardData: CardData = JSON.parse(fs.readFileSync(cardDataPath, 'utf-8'));

  const systemPrompt = [
    'You are a character initialization engine. Given a character\'s identity and system prompt,',
    'generate their initial behavioral state using the generate_character_init tool.',
    '',
    'Guidelines:',
    '- impulse_narrative: Write in first person, in the character\'s language. Short internal monologue',
    '  reflecting their personality at rest, before any user interaction.',
    '- emotion_baseline: Calibrate to the character. A cheerful character has higher joy baseline.',
    '  A shy character has higher anxiety baseline. Values should range 0.1 to 0.7.',
    '- soul_description: Concise behavioral guide in English. Cover: speech patterns, emotional tendencies,',
    '  relationship style, key behavioral rules.',
  ].join('\n');

  const userMessage = [
    `Character Name: ${cardData.character_name}`,
    `Language: ${cardData.detected_language}`,
    '',
    '--- System Prompt ---',
    cardData.system_prompt,
    '',
    cardData.post_history_instructions ? `--- Post-History Instructions ---\n${cardData.post_history_instructions}` : '',
  ].filter(Boolean).join('\n');

  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const body = {
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: [GENERATE_CHARACTER_INIT_TOOL],
    tool_choice: { type: 'tool', name: 'generate_character_init' },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`[import-llm] LLM returned ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    };

    if (!data.content || !Array.isArray(data.content)) return null;

    const toolBlock = data.content.find(
      b => b.type === 'tool_use' && b.name === 'generate_character_init',
    );
    if (!toolBlock?.input) return null;

    const result = sanitizeImportResult(toolBlock.input);

    // Write IMPULSE.md
    const impulsePath = path.join(workspacePath, 'IMPULSE.md');
    fs.writeFileSync(
      impulsePath,
      `# Impulse\n\nvalue: 0.300\nfired: false\ndecision: suppress\nnarrative: ${result.impulse_narrative}\n`,
      'utf-8',
    );

    // Write SOUL.md
    const soulPath = path.join(workspacePath, 'SOUL.md');
    fs.writeFileSync(soulPath, `# Soul\n\n${result.soul_description}\n`, 'utf-8');

    console.log('[import-llm] generated IMPULSE.md and SOUL.md');
    return result;
  } catch (err) {
    console.error('[import-llm] LLM call failed:', err);
    return null;
  }
}

const EMOTION_DIMENSIONS: EmotionDimension[] = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'];

function sanitizeImportResult(raw: Record<string, unknown>): ImportLLMResult {
  const emotionRaw = (raw.emotion_baseline ?? {}) as Record<string, number>;
  const baseline: Partial<Record<EmotionDimension, number>> = {};
  for (const d of EMOTION_DIMENSIONS) {
    if (typeof emotionRaw[d] === 'number') {
      baseline[d] = Math.min(1, Math.max(0, emotionRaw[d]));
    }
  }

  return {
    impulse_narrative: typeof raw.impulse_narrative === 'string' ? raw.impulse_narrative : '',
    emotion_baseline: baseline,
    soul_description: typeof raw.soul_description === 'string' ? raw.soul_description : '',
  };
}
