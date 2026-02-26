/**
 * System 1 — Mega-prompt builder.
 * PRD v6.0 §3.2
 */

import { randomBytes } from 'node:crypto';
import type { System1PromptParams, System1PromptResult } from './types.js';

const LANGUAGE_LABELS: Record<string, string> = {
  zh: 'Chinese (Mandarin)',
  en: 'English',
  ja: 'Japanese',
};

/**
 * Build the System 1 mega-prompt (system + messages).
 * System prompt is in English for best cross-language generalization.
 */
export function buildSystem1Prompt(params: System1PromptParams): System1PromptResult {
  const nonce = randomBytes(4).toString('hex');
  const langLabel = LANGUAGE_LABELS[params.language] ?? params.language;

  const system = [
    'You are a cognitive filter for an AI character. Your job is to process incoming events',
    'through the character\'s personality and emotional state, then output structured analysis',
    'via the process_event tool.',
    '',
    '## Character Cognitive Filter',
    params.characterFilter,
    '',
    '## Instructions',
    '- Classify the event type and importance from the character\'s perspective.',
    '- Interpret emotional impact as deltas (each between -0.3 and +0.3) on the 6 dimensions: joy, sadness, anger, anxiety, longing, trust.',
    '- Only include dimensions that are actually affected. Omit unchanged dimensions.',
    '- Write cognitive_projection as the character\'s inner monologue — what they would think.',
    '- List any additional World Info entry IDs (from the candidates) that should be activated.',
    `- Write impulse_narrative in ${langLabel} — this is the character's current impulse state.`,
    '- Decide if this event is worth saving to long-term memory.',
    '',
    '## Output',
    'You MUST call the process_event tool with your analysis. Do not output plain text.',
  ].join('\n');

  // Build user message content
  const parts: string[] = [];

  // a. Current emotion state
  const emotionLines = Object.entries(params.emotionState)
    .map(([dim, val]) => `  ${dim}: ${(val as number).toFixed(3)}`)
    .join('\n');
  parts.push(`## Current Emotion State\n${emotionLines}`);

  // b. Event content with nonce separators
  parts.push(
    `## Event (trigger: ${params.triggerType})`,
    `<<<EVENT_START_${nonce}>>>`,
    params.eventContent,
    `<<<EVENT_END_${nonce}>>>`,
  );

  // c. Previous impulse narrative
  if (params.previousImpulse) {
    parts.push(`## Previous Impulse\n${params.previousImpulse}`);
  }

  // d. WI candidate summaries
  if (params.wiCandidates.length > 0) {
    const wiLines = params.wiCandidates
      .map(c => `- [${c.id}] ${c.summary}`)
      .join('\n');
    parts.push(`## World Info Candidates (${params.wiCandidates.length})\n${wiLines}`);
  }

  return {
    system,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  };
}
