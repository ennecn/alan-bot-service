/**
 * System 2 LLM client — streaming Anthropic Messages API.
 * PRD v6.0 §3.3
 *
 * Degradation:
 * - Timeout → retry once → return hesitate text ("...")
 * - Unreachable → return preset short reply
 */

import type { System2Config, System2StreamChunk, System2Result } from './types.js';

const S2_TIMEOUT_MS = 60_000;

interface AssembledPrompt {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Call System 2 LLM with streaming.
 * Returns an async iterator of chunks + final text accumulator.
 */
export async function callSystem2(
  prompt: AssembledPrompt,
  config: System2Config,
): Promise<System2Result> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await doCall(prompt, config);
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        console.warn('[system2] First attempt failed, retrying...', err);
      }
    }
  }

  // Degradation: return hesitate
  console.error('[system2] All attempts failed, degrading to hesitate', lastError);
  const hesitateText = '...';
  return {
    text: hesitateText,
    stream: (async function* () {
      yield { type: 'text_delta' as const, text: hesitateText };
      yield { type: 'stop' as const, usage: { input_tokens: 0, output_tokens: 1 } };
    })(),
    usage: { input_tokens: 0, output_tokens: 1 },
  };
}

async function doCall(
  prompt: AssembledPrompt,
  config: System2Config,
): Promise<System2Result> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: prompt.system,
    messages: prompt.messages,
    stream: true,
  };
  if (config.sampler) {
    if (config.sampler.temperature !== undefined) body.temperature = config.sampler.temperature;
    if (config.sampler.top_p !== undefined) body.top_p = config.sampler.top_p;
    if (config.sampler.top_k !== undefined) body.top_k = config.sampler.top_k;
    if (config.sampler.frequency_penalty !== undefined) body.frequency_penalty = config.sampler.frequency_penalty;
    if (config.sampler.presence_penalty !== undefined) body.presence_penalty = config.sampler.presence_penalty;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), S2_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`System 2 HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('System 2 response has no body');
  }

  let fullText = '';
  let usage = { input_tokens: 0, output_tokens: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  async function* parseSSE(): AsyncGenerator<System2StreamChunk> {
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;

          try {
            const event = JSON.parse(data);

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              const text = event.delta.text ?? '';
              fullText += text;
              yield { type: 'text_delta', text };
            }

            if (event.type === 'message_delta' && event.usage) {
              usage.output_tokens = event.usage.output_tokens ?? usage.output_tokens;
            }

            if (event.type === 'message_start' && event.message?.usage) {
              usage.input_tokens = event.message.usage.input_tokens ?? 0;
            }

            if (event.type === 'message_stop') {
              yield { type: 'stop', usage: { ...usage } };
              return;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Stream ended without message_stop — still yield stop
    yield { type: 'stop', usage: { ...usage } };
  }

  const stream = parseSSE();

  return {
    get text() { return fullText; },
    stream,
    get usage() { return { ...usage }; },
  } as System2Result;
}
