import { resolve } from 'path';

export interface MetroidConfig {
  dataDir: string;
  dbPath: string;

  // Memory settings
  memory: {
    encodingSampleRate: number;   // 0-1, default 0.3
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
  };

  // Growth engine
  growth: {
    evaluationInterval: number;  // evaluate every N messages
    minConfidence: number;       // threshold to apply change
    maxActiveChanges: number;    // cap on active behavioral changes
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
  },

  compiler: {
    responseReserveRatio: 0.3,
  },

  emotion: {
    minChangeInterval: 30_000,
    maxChangePerUpdate: 0.3,
    recoveryRate: 0.05,
  },

  growth: {
    evaluationInterval: 10,
    minConfidence: 0.5,
    maxActiveChanges: 20,
  },
};
