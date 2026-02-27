// Types continued — Actions, Triggers, Config

import type { EmotionDimension, EmotionState } from './index.js';

// ============================================================
// Trigger Types
// ============================================================

export type TriggerType =
  | 'user_message'
  | 'heartbeat'
  | 'cron'
  | 'direct_message'
  | 'social_notification'
  | 'fact_sync'
  | 'system_event';

// ============================================================
// Action System (8.3)
// ============================================================

export type Action =
  | { type: 'reply'; content: string; delay?: number }
  | { type: 'hesitate' }
  | { type: 'suppress' }
  | { type: 'post_moment'; content: string; mood: string }
  | { type: 'notify_agent'; target: string; fact: string }
  | { type: 'update_memory'; content: string }
  | { type: 'like'; target: string }
  | { type: 'comment'; target: string; content: string }
  | { type: 'learn_skill'; skill: string; source: string }
  | { type: 'retract_hesitation'; message_id: string };

// ============================================================
// Behavior Decision (6.3.1)
// ============================================================

export type BehaviorDecision = 'reply' | 'suppress' | 'hesitate';

// ============================================================
// Coordinator Metrics (9.3)
// ============================================================

export interface CoordinatorMetrics {
  timestamp: string;
  trigger: TriggerType;
  duration_ms: number;
  system1_ms: number;
  system2_ms: number | null;
  emotion_delta: Partial<Record<EmotionDimension, number>>;
  wi_activated: number;
  wi_total: number;
  actions: string[];
  token_usage: {
    s1_in: number;
    s1_out: number;
    s2_in: number | null;
    s2_out: number | null;
  };
  degraded: boolean;
  extraction_fallback?: boolean;
}

// ============================================================
// World Info (4.5)
// ============================================================

export interface WIEntry {
  id: string;
  keys: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  selective_logic?: 'AND_ANY' | 'AND_ALL' | 'NOT_ANY' | 'NOT_ALL';
  constant?: boolean;
  enabled?: boolean;
  position?: number; // 0-7
  depth?: number;
  order?: number;
  weight?: number;
  probability?: number;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  group?: string;
  scan_depth?: number;
  case_sensitive?: boolean;
  whole_words?: boolean;
  regex?: boolean;
  // Alan extensions
  state_conditions?: Record<string, { min?: number; max?: number }>;
  temporal_conditions?: { after?: string; before?: string; day_of_week?: number[] };
  embedding?: number[] | 'pending';
}

// ============================================================
// WI Signal Weights (3.5)
// ============================================================

export interface WISignalWeights {
  text_scanner: number;    // default 0.4
  semantic_scorer: number; // default 0.3
  state_evaluator: number; // default 0.2
  temporal_evaluator: number; // default 0.1
}

export const DEFAULT_WI_WEIGHTS: WISignalWeights = {
  text_scanner: 0.4,
  semantic_scorer: 0.3,
  state_evaluator: 0.2,
  temporal_evaluator: 0.1,
};

export const DEFAULT_WI_ACTIVATION_THRESHOLD = 0.5;

// ============================================================
// Alan Engine Config
// ============================================================

export interface AlanConfig {
  /** Port for the Anthropic-compatible API server */
  port: number;
  /** Path to workspace directory (bind-mounted) */
  workspace_path: string;
  /** LLM Gateway base URL for System 1 */
  system1_base_url: string;
  /** LLM Gateway base URL for System 2 */
  system2_base_url: string;
  /** System 1 model name */
  system1_model: string;
  /** System 2 model name */
  system2_model: string;
  /** Embedding proxy URL */
  embedding_url: string;
  /** Embedding API key (optional — omit if proxy handles auth) */
  embedding_api_key?: string;
  /** Embedding model name (default 'BAAI/bge-m3') */
  embedding_model?: string;
  /** Event Bus URL */
  event_bus_url: string;
  /** Event Bus API key for this agent */
  event_bus_key: string;
  /** Agent ID */
  agent_id: string;
  /** Fire threshold for impulse (default 0.6) */
  fire_threshold: number;
  /** User message impulse increment (default 0.1) */
  user_message_increment: number;
  /** Session timeout in hours (default 4) */
  session_timeout_hours: number;
  /** WI signal weights */
  wi_weights: WISignalWeights;
  /** WI activation threshold */
  wi_activation_threshold: number;
  /** API key for System 1 LLM (optional — omit to rely on proxy auth) */
  s1_api_key?: string;
  /** API key for System 2 LLM (optional — omit to rely on proxy auth) */
  s2_api_key?: string;
  /** Max tokens for System 2 response (default 4000) */
  s2_max_tokens: number;
  /** Character language for impulse narrative (default 'zh') */
  character_language: 'zh' | 'en' | 'ja';
  /** LLM base URL for card import (falls back to system1_base_url) */
  import_llm_base_url?: string;
  /** LLM model for card import (falls back to system1_model) */
  import_llm_model?: string;
  /** API key for card import LLM (falls back to s1_api_key) */
  import_llm_api_key?: string;
}
