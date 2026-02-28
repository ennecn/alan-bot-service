/**
 * Coordinator types — events, pipeline context, action list.
 */

import type { TriggerType, Action, BehaviorDecision, CoordinatorMetrics } from '../types/actions.js';
import type { EmotionSnapshot, ImpulseResult, System1Output } from '../types/index.js';
import type { System2StreamChunk } from './system2/types.js';

export interface CoordinatorEvent {
  trigger: TriggerType;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ActionList {
  decision: BehaviorDecision;
  actions: Action[];
  metrics: CoordinatorMetrics;
  impulse: ImpulseResult;
  emotion: EmotionSnapshot;
  system1: System1Output;
  reply?: string;
  stream?: AsyncIterable<System2StreamChunk>;
}

export interface PipelineContext {
  event: CoordinatorEvent;
  elapsedHours: number;
  sessionId: string;
  emotionBefore: EmotionSnapshot;
  system1Output: System1Output;
  impulse: ImpulseResult;
  decision: BehaviorDecision;
  emotionAfter: EmotionSnapshot;
  emotionNarrative: string;
}
