// API response types — mirrors backend models

export interface ModelEntry {
  id: string;
  label: string;
  base_url: string;
  api_key?: string;
  model_id: string;
  role: 's1' | 's2';
  added_at: string;
}

export interface ModelRegistry {
  models: ModelEntry[];
  active: { s1?: string; s2?: string };
}

export interface CardManifestEntry {
  id: string;
  name: string;
  file: string;
  detected_language: string;
  wi_count: number;
  active: boolean;
  imported_at: string;
}

export interface CardDetail extends CardManifestEntry {
  identity: string | null;
  soul: string | null;
  memory: string | null;
  card_data: {
    character_name: string;
    detected_language: string;
    system_prompt: string;
    post_history_instructions: string;
    mes_example: string;
  } | null;
}

export interface PresetManifestEntry {
  id: string;
  source_name: string;
  file: string;
  active: boolean;
  imported_at: string;
}

export interface EmotionState {
  joy: number;
  sadness: number;
  anger: number;
  anxiety: number;
  longing: number;
  trust: number;
}

export interface EmotionSnapshot {
  current: EmotionState;
  baseline: EmotionState;
  memory_pools?: {
    attachment_pool: number;
    stress_pool: number;
  };
  custom_state?: Record<string, number>;
  suppression: {
    count: number;
    consecutive_hesitate: number;
    accumulated: number;
    last_suppress: string | null;
  };
  last_interaction: string;
  session_start: string;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
  metadata?: string;
}

export interface SessionInfo {
  session_id: string;
  last_message: string;
  message_count: number;
}

export interface DebugState {
  emotion: EmotionSnapshot | null;
  impulse: string | null;
  wi: { total: number };
  card: {
    character_name: string;
    detected_language: string;
    behavioral_engine?: {
      custom_emotions?: Record<string, {
        range: [number, number];
        baseline: number;
        projection?: Partial<EmotionState>;
      }>;
    };
  } | null;
  preset: {
    source_name: string;
    sampler: Record<string, number>;
  } | null;
  session: SessionInfo | null;
  models: {
    s1: { base_url: string; model: string };
    s2: { base_url: string; model: string };
    registry: ModelRegistry | null;
  };
  agent_id: string;
  uptime_s: number;
}
