/**
 * System 2 types — streaming LLM client for final reply generation.
 * PRD v6.0 §3.3
 */

export interface SamplerParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface System2Config {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens: number;
  sampler?: SamplerParams;
}

export interface System2StreamChunk {
  type: 'text_delta' | 'stop' | 'error';
  text?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface System2Result {
  text: string;
  stream: AsyncIterable<System2StreamChunk>;
  usage: { input_tokens: number; output_tokens: number };
}
