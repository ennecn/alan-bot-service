/**
 * Alan HTTP Client -- sends messages to Alan Engine's Anthropic-compatible API.
 * Parses SSE stream for content.
 */

export interface AlanClientConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export interface AlanResponse {
  text: string;
  latency_ms: number;
  tokens: { input: number; output: number };
}

export async function sendMessage(
  content: string,
  config: AlanClientConfig,
  systemPrompt?: string,
): Promise<AlanResponse> {
  const start = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  }

  const body: Record<string, unknown> = {
    model: config.model ?? 'claude-opus-4-6',
    max_tokens: config.maxTokens ?? 4000,
    stream: true,
    messages: [{ role: 'user', content }],
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Alan API error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  let text = '';
  let tokens = { input: 0, output: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.text === 'string') {
          text += delta.text;
        }
      } else if (parsed.type === 'message_delta') {
        const usage = parsed.usage as Record<string, number> | undefined;
        if (usage) {
          tokens = {
            input: usage.input_tokens ?? tokens.input,
            output: usage.output_tokens ?? tokens.output,
          };
        }
      }
    }
  }

  return {
    text,
    latency_ms: Date.now() - start,
    tokens,
  };
}
