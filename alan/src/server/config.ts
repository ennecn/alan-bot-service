import type { AlanConfig, WISignalWeights } from '../types/actions.js';

const DEFAULT_WI_WEIGHTS: WISignalWeights = {
  text_scanner: 0.4,
  semantic_scorer: 0.3,
  state_evaluator: 0.2,
  temporal_evaluator: 0.1,
};

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}

export function loadConfig(): AlanConfig {
  return {
    port: envInt('ALAN_PORT', 7088),
    workspace_path: env('ALAN_WORKSPACE', '/home/node/.openclaw/workspace'),
    system1_base_url: env('ALAN_S1_BASE_URL', 'http://127.0.0.1:8080'),
    system2_base_url: env('ALAN_S2_BASE_URL', 'http://127.0.0.1:8080'),
    system1_model: env('ALAN_S1_MODEL', 'gemini-2.5-flash'),
    system2_model: env('ALAN_S2_MODEL', 'claude-opus-4-6'),
    embedding_url: env('ALAN_EMBEDDING_URL', 'http://127.0.0.1:8080'),
    event_bus_url: env('ALAN_EVENT_BUS_URL', ''),
    event_bus_key: env('ALAN_EVENT_BUS_KEY', ''),
    agent_id: env('ALAN_AGENT_ID', 'alan-default'),
    fire_threshold: envFloat('ALAN_FIRE_THRESHOLD', 0.6),
    user_message_increment: envFloat('ALAN_USER_MSG_INCREMENT', 0.1),
    session_timeout_hours: envInt('ALAN_SESSION_TIMEOUT_HOURS', 4),
    wi_weights: DEFAULT_WI_WEIGHTS,
    wi_activation_threshold: envFloat('ALAN_WI_THRESHOLD', 0.5),
    s1_api_key: process.env.ALAN_S1_API_KEY || undefined,
    s2_api_key: process.env.ALAN_S2_API_KEY || undefined,
    s2_max_tokens: envInt('ALAN_S2_MAX_TOKENS', 4000),
    character_language: (env('ALAN_CHARACTER_LANGUAGE', 'zh') as 'zh' | 'en' | 'ja'),
    import_llm_base_url: process.env.ALAN_IMPORT_LLM_BASE_URL
      || env('ALAN_S1_BASE_URL', 'http://127.0.0.1:8080'),
    import_llm_model: process.env.ALAN_IMPORT_LLM_MODEL
      || env('ALAN_S1_MODEL', 'gemini-2.5-flash'),
    import_llm_api_key: process.env.ALAN_IMPORT_LLM_API_KEY
      || process.env.ALAN_S1_API_KEY || undefined,
  };
}
