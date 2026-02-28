/**
 * SillyTavern Preset Import — Type Definitions
 *
 * Raw ST preset JSON shape and Alan's internal representation.
 */

// ── Raw ST Preset (parsed from file) ──

export interface STPresetRaw {
  // Sampler
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  openai_max_context?: number;
  openai_max_tokens?: number;
  // Prompt blocks and ordering
  prompts?: STPromptBlock[];
  prompt_order?: Array<{ character_id: number; order: STPromptOrderEntry[] }>;
  [key: string]: unknown;
}

export interface STPromptBlock {
  identifier: string;
  name: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  marker: boolean;
  injection_position: number; // 0 = relative, 1 = absolute depth
  injection_depth: number;
  injection_order: number;
  forbid_overrides: boolean;
  enabled: boolean;
}

export interface STPromptOrderEntry {
  identifier: string;
  enabled: boolean;
}

// ── Alan Internal Representation (stored as workspace/internal/preset.json) ──

export interface AlanPreset {
  source_name: string;
  imported_at: string;
  sampler: SamplerParams;
  system_prefix: string;
  post_history: string;
  depth_injections: DepthInjection[];
  assistant_prefill?: string;
  max_context_tokens?: number;
  max_output_tokens?: number;
  raw_prompt_order?: STPromptOrderEntry[];
}

export interface SamplerParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface DepthInjection {
  content: string;
  depth: number;
  role: 'system' | 'user' | 'assistant';
  order: number;
}
