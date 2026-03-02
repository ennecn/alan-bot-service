/**
 * ST Card V2 types and behavioral engine config.
 */

import type { EmotionDimension } from '../types/index.js';

/** ST Card V2 World Info entry (raw from card JSON) */
export interface STCardWIEntry {
  keys: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  selective_logic?: number; // 0=AND_ANY, 1=AND_ALL, 2=NOT_ANY, 3=NOT_ALL
  constant?: boolean;
  enabled?: boolean;
  position?: number;
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
  extensions?: Record<string, unknown>;
}

export interface STCardCharacterBook {
  entries: STCardWIEntry[];
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
}

export interface CustomEmotionConfig {
  range: [number, number];
  baseline: number;
  /**
   * Optional projection weights onto base 6 emotions.
   * If omitted, engine falls back to name-based heuristic projection.
   */
  projection?: Partial<Record<EmotionDimension, number>>;
}

export interface BehavioralEngineConfig {
  schema_version: string;
  emotion_baseline?: Partial<Record<EmotionDimension, number>>;
  sensitivity?: Partial<Record<EmotionDimension, number>>;
  thresholds?: {
    fire?: number;
    suppress_ceiling?: number;
  };
  emotion_templates?: Record<string, Partial<Record<EmotionDimension, number>>>;
  custom_emotions?: Record<string, CustomEmotionConfig>;
}

export interface STCardV2 {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  alternate_greetings?: string[];
  system_prompt?: string;
  post_history_instructions?: string;
  creator_notes?: string;
  tags?: string[];
  creator?: string;
  character_version?: string;
  character_book?: STCardCharacterBook;
  extensions?: {
    behavioral_engine?: BehavioralEngineConfig;
    [key: string]: unknown;
  };
}

/** Wrapper: spec_version + data */
export interface STCardV2Wrapper {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: STCardV2;
}

export interface ImportResult {
  identity_path: string;
  system_prompt: string | undefined;
  post_history_instructions: string | undefined;
  mes_example: string;
  greetings: string[];
  behavioral_engine: BehavioralEngineConfig | undefined;
  wi_count: number;
  detected_language: string;
}
