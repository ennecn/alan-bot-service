/**
 * Impulse Calculator — Deterministic impulse score from 6 components.
 * PRD v6.0 §3.1.1
 */

import type { EmotionDimension } from '../types/index.js';
import type { ImpulseComponents, ImpulseResult } from '../types/index.js';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface ImpulseParams {
  /** Base impulse level, default 0.3 */
  baseImpulse?: number;
  /** Absolute emotion deltas from System 1 */
  emotionDeltas: Partial<Record<EmotionDimension, number>>;
  /** Weight for emotion urgency, default 1.0 */
  urgencyWeight?: number;
  /** Number of consecutive suppressions */
  suppressionCount: number;
  /** Hours since last interaction */
  hoursSinceLastInteraction: number;
  /** Time threshold for time pressure, default 2.0 */
  timeThreshold?: number;
  /** Steepness for sigmoid, default 1.0 */
  steepness?: number;
  /** Event importance from System 1 (0.0 | 0.3 | 0.6 | 1.0) */
  eventImportance: number;
  /** Number of consecutive unreplied user messages */
  consecutiveUnreplied: number;
  /** User message increment per unreplied, default 0.1 */
  userMessageIncrement?: number;
  /** Fire threshold, default 0.6 */
  fireThreshold?: number;
}

/**
 * Calculate impulse score from 6 additive components.
 *
 * impulse = clamp(0, 1,
 *   base_impulse
 *   + max(abs(deltas)) * urgency_weight
 *   + suppression_count * 0.15
 *   + sigmoid((hours - threshold) * steepness) * 0.3
 *   + event_importance * 0.2
 *   + 0.1 * consecutive_unreplied
 * )
 */
export function calculateImpulse(params: ImpulseParams): ImpulseResult {
  const baseImpulse = params.baseImpulse ?? 0.3;
  const urgencyWeight = params.urgencyWeight ?? 1.0;
  const timeThreshold = params.timeThreshold ?? 2.0;
  const steepness = params.steepness ?? 1.0;
  const userMsgInc = params.userMessageIncrement ?? 0.1;
  const fireThreshold = params.fireThreshold ?? 0.6;

  // Component 1: base
  const base = baseImpulse;

  // Component 2: emotion urgency = max(abs(deltas)) * weight
  const absDeltas = Object.values(params.emotionDeltas).map(v => Math.abs(v ?? 0));
  const emotionUrgency = (absDeltas.length > 0 ? Math.max(...absDeltas) : 0) * urgencyWeight;

  // Component 3: suppression pressure
  const suppressionPressure = params.suppressionCount * 0.15;

  // Component 4: time pressure
  const timePressure = sigmoid((params.hoursSinceLastInteraction - timeThreshold) * steepness) * 0.3;

  // Component 5: event importance
  const eventImp = params.eventImportance * 0.2;

  // Component 6: user message increment
  const userMsgIncrement = userMsgInc * params.consecutiveUnreplied;

  const raw = base + emotionUrgency + suppressionPressure + timePressure + eventImp + userMsgIncrement;
  const value = clamp01(raw);

  const components: ImpulseComponents = {
    base_impulse: base,
    emotion_urgency: emotionUrgency,
    suppression_pressure: suppressionPressure,
    time_pressure: timePressure,
    event_importance: eventImp,
    user_message_increment: userMsgIncrement,
  };

  return {
    value,
    components,
    fire_threshold: fireThreshold,
    fired: value >= fireThreshold,
  };
}
