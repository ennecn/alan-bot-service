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
};
