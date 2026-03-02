/**
 * System 1 — Local types for prompt building and API calls.
 */

import type { EmotionState } from '../../types/index.js';
import type { TriggerType } from '../../types/actions.js';

export interface CustomEmotionPromptState {
  name: string;
  current: number;
  baseline: number;
  range: [number, number];
}

export interface System1PromptParams {
  /** Character cognitive filter / persona description */
  characterFilter: string;
  /** Current emotion state (numerical) */
  emotionState: EmotionState;
  /** Raw event content (user message, heartbeat payload, etc.) */
  eventContent: string;
  /** What triggered this pipeline run */
  triggerType: TriggerType;
  /** WI candidates from pre-filter (id + first 100 chars) */
  wiCandidates: { id: string; summary: string }[];
  /** Character's language for impulse_narrative */
  language: 'zh' | 'en' | 'ja';
  /** Previous IMPULSE.md content (null on first turn) */
  previousImpulse: string | null;
  /** Optional configured custom emotions and current values */
  customEmotions?: CustomEmotionPromptState[];
}

export interface System1CallParams extends System1PromptParams {
  /** Previous impulse narrative (alias for previousImpulse, kept for API compat) */
  oldImpulse: string | null;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface System1PromptResult {
  system: string;
  messages: AnthropicMessage[];
}
