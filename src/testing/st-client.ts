/**
 * ST HTTP Client -- sends messages to SillyTavern's API.
 */

export interface STClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface STResponse {
  text: string;
  latency_ms: number;
  tokens: { input: number; output: number };
}

export async function sendMessage(
  content: string,
  config: STClientConfig,
  characterName?: string,
): Promise<STResponse> {
  const start = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const body: Record<string, unknown> = {
    message: content,
  };
  if (characterName) {
    body.character_name = characterName;
  }

  const response = await fetch(`${config.baseUrl}/api/chats/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`ST API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const reply = typeof json.reply === 'string' ? json.reply : '';
  const latency_ms = Date.now() - start;

  return {
    text: reply,
    latency_ms,
    tokens: {
      input: Math.ceil(content.length / 4),
      output: Math.ceil(reply.length / 4),
    },
  };
}
