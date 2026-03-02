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
  custom_emotions?: Record<string, {
    range: [number, number];
    baseline: number;
    projection?: Partial<Record<EmotionDimension, number>>;
  }>;
}

export interface SuppressionFatigue {
  count: number;
  consecutive_hesitate: number;
  accumulated: number;
  last_suppress: string | null; // ISO timestamp
}

export interface MemoryPools {
  attachment_pool: number;
  stress_pool: number;
}

export interface EmotionSnapshot {
  current: EmotionState;
  baseline: EmotionState;
  suppression: SuppressionFatigue;
  memory_pools?: MemoryPools;
  custom_state?: Record<string, number>;
  last_interaction: string; // ISO timestamp
  session_start: string;    // ISO timestamp
  directive_history?: string[]; // last 3 writeDirective pattern IDs (PRD §2.1.5)
  banned_word_streak?: Record<string, number>; // consecutive hit count per banned word (PRD §2.3.3)
}

// ============================================================
// Impulse System (3.1.1)
// ============================================================

export interface ImpulseComponents {
  base_impulse: number;
  emotion_urgency: number;
  suppression_pressure: number;
  memory_pressure: number;
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
  custom_deltas?: Record<string, number>; // each clamped ±0.3, filtered by configured custom_emotions
  cognitive_projection: string;
  wi_expansion: string[]; // WI entry IDs to additionally activate
  impulse_narrative: string; // IMPULSE.md content
  memory_consolidation: {
    should_save: boolean;
    summary: string;
  };
  social_actions?: {
    should_post?: boolean;
    post_content?: string;
    post_mood?: string;
    should_react?: boolean;
    react_target?: string;
    react_type?: 'like' | 'comment';
    react_content?: string;
  };
}
