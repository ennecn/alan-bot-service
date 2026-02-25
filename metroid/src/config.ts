import { resolve } from 'path';

export interface MetroidConfig {
  dataDir: string;
  dbPath: string;

  // Memory settings
  memory: {
    encodingSampleRate: number;   // deprecated: all messages are now stored
    importanceThreshold: number;  // min importance to promote STM→LTM
    fadeThreshold: number;        // below this = faded
    maxRetrievalResults: number;
    defaultTimeWindowHours: number;
  };

  // LLM settings
  llm: {
    apiKey: string;
    baseUrl?: string;
    mainModel: string;            // for conversation
    lightModel: string;           // for encoding, classification
    maxContextTokens: number;
    // OpenAI-compatible API (e.g. SiliconFlow, OpenRouter)
    openaiBaseUrl?: string;       // if set, use OpenAI format instead of Anthropic
    openaiApiKey?: string;
    openaiModel?: string;         // model name for OpenAI-compatible API
    openaiModelFallback?: string; // fallback model when primary fails
    fallbackMaxRetries?: number;  // max retries before giving up (default 1)
    requestTimeoutMs?: number;    // per-request timeout (default 60000)
  };

  // Prompt compiler
  compiler: {
    responseReserveRatio: number; // portion reserved for response
  };

  // Emotion engine
  emotion: {
    minChangeInterval: number;   // ms between updates
    maxChangePerUpdate: number;  // max PAD axis delta
    recoveryRate: number;        // per-hour drift toward baseline
    // Dedicated LLM for emotion analysis (falls back to llm.openai* if unset)
    llmBaseUrl?: string;
    llmApiKey?: string;
    llmModel?: string;
  };

  // Growth engine
  growth: {
    evaluationInterval: number;  // evaluate every N messages
    minConfidence: number;       // threshold to apply change
    maxActiveChanges: number;    // cap on active behavioral changes
    confidenceDecayRate: number;     // per-day decay (default 0.02)
    confidenceDecayGraceDays: number; // grace period before decay starts (default 7)
  };

  // Proactive engine
  proactive: {
    checkIntervalMs: number;     // how often to evaluate triggers (default 60s)
    maxPendingMessages: number;  // max queued messages per agent (default 5)
    defaultCooldownMinutes: number; // default cooldown between firings (default 60)
    // Impulse accumulator defaults
    impulseDecayRate: number;       // per-hour natural decay (default 0.1)
    impulseFireThreshold: number;   // base threshold to fire (default 0.6)
    impulseCooldownMinutes: number; // min time between impulse firings (default 30)
  };
}

const dataDir = process.env.METROID_DATA_DIR || resolve(process.cwd(), 'data');

export const defaultConfig: MetroidConfig = {
  dataDir,
  dbPath: resolve(dataDir, 'metroid.db'),

  memory: {
    encodingSampleRate: 0.3,
    importanceThreshold: 0.4,
    fadeThreshold: 0.3,
    maxRetrievalResults: 5,
    defaultTimeWindowHours: 72,
  },

  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    mainModel: 'claude-opus-4-6',
    lightModel: 'claude-haiku-4-5-20251001',
    maxContextTokens: 200_000,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    openaiModelFallback: process.env.OPENAI_MODEL_FALLBACK,
    fallbackMaxRetries: 1,
    requestTimeoutMs: 60_000,
  },

  compiler: {
    responseReserveRatio: 0.3,
  },

  emotion: {
    minChangeInterval: 30_000,
    maxChangePerUpdate: 0.3,
    recoveryRate: 0.05,
    llmBaseUrl: process.env.EMOTION_LLM_BASE_URL,
    llmApiKey: process.env.EMOTION_LLM_API_KEY,
    llmModel: process.env.EMOTION_LLM_MODEL,
  },

  growth: {
    evaluationInterval: 10,
    minConfidence: 0.5,
    maxActiveChanges: 20,
    confidenceDecayRate: 0.02,
    confidenceDecayGraceDays: 7,
  },

  proactive: {
    checkIntervalMs: 60_000,
    maxPendingMessages: 5,
    defaultCooldownMinutes: 60,
    impulseDecayRate: 0.1,
    impulseFireThreshold: 0.6,
    impulseCooldownMinutes: 30,
  },
};
