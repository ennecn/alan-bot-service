/**
 * Alan Engine — Core Type Definitions
 * Based on PRD v6.0
 */

// ============================================================
// Emotion System (3.1.2)
// ============================================================

/** 6 base emotion dimensions */
export type EmotionDimension = 'joy' | 'sadness' | 'anger' | 'anxiety' | 'longing' | 'trust';

export type EmotionState = Record<EmotionDimension, number>;

export interface EmotionConfig {
  baseline: Partial<EmotionState>;
  half_life: Partial<Record<EmotionDimension, number>>; // hours, default 2.0
  custom_emotions?: Record<string, { range: [number, number]; baseline: number }>;
}

export interface SuppressionFatigue {
  count: number;
  consecutive_hesitate: number;
  accumulated: number;
  last_suppress: string | null; // ISO timestamp
}

export interface EmotionSnapshot {
  current: EmotionState;
  baseline: EmotionState;
  suppression: SuppressionFatigue;
  last_interaction: string; // ISO timestamp
  session_start: string;    // ISO timestamp
}

// ============================================================
// Impulse System (3.1.1)
// ============================================================

export interface ImpulseComponents {
  base_impulse: number;
  emotion_urgency: number;
  suppression_pressure: number;
  time_pressure: number;
  event_importance: number;
  user_message_increment: number;
}

export interface ImpulseResult {
  value: number;           // clamped [0, 1]
  components: ImpulseComponents;
  fire_threshold: number;
  fired: boolean;
}

// ============================================================
// System 1 Output (3.2)
// ============================================================

export type EventImportance = 0.0 | 0.3 | 0.6 | 1.0;

export interface System1Output {
  event_classification: {
    type: string;
    importance: EventImportance;
  };
  emotional_interpretation: Partial<Record<EmotionDimension, number>>; // each clamped ±0.3
  cognitive_projection: string;
  wi_expansion: string[]; // WI entry IDs to additionally activate
  impulse_narrative: string; // IMPULSE.md content
  memory_consolidation: {
    should_save: boolean;
    summary: string;
  };
}
