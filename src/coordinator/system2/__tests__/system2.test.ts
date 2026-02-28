import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { callSystem2 } from '../client.js';
import type { System2Config, System2StreamChunk } from '../types.js';

// --- Helpers ---

function sseLines(events: Array<{ type: string; data: Record<string, unknown> }>): string {
  return events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify({ type: e.type, ...e.data })}`)
    .join('\n\n') + '\n\n';
}

function makeConfig(port: number): System2Config {
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    model: 'test-model',
    maxTokens: 100,
  };
}

const prompt = {
  system: 'You are a test assistant.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

let servers: Array<ReturnType<typeof serve>> = [];

function startServer(app: Hono, port: number): Promise<void> {
  return new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port }, () => resolve());
    servers.push(s);
  });
}

afterEach(() => {
  for (const s of servers) {
    s.close();
  }
  servers = [];
});

// --- Tests ---

describe('callSystem2', () => {
  it('streams text deltas correctly', async () => {
    const PORT = 19201;
    const app = new Hono();
    app.post('/v1/messages', (c) => {
      const body = sseLines([
        { type: 'message_start', data: { message: { usage: { input_tokens: 10 } } } },
        { type: 'content_block_start', data: { index: 0, content_block: { type: 'text', text: '' } } },
        { type: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'Hello' } } },
        { type: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: ' world' } } },
        { type: 'content_block_stop', data: { index: 0 } },
        { type: 'message_delta', data: { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } } },
        { type: 'message_stop', data: {} },
      ]);
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    await startServer(app, PORT);

    const result = await callSystem2(prompt, makeConfig(PORT));
    const chunks: System2StreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === 'text_delta');
    expect(textChunks).toHaveLength(2);
    expect(textChunks[0].text).toBe('Hello');
    expect(textChunks[1].text).toBe(' world');
    expect(result.text).toBe('Hello world');

    const stopChunk = chunks.find((c) => c.type === 'stop');
    expect(stopChunk).toBeDefined();
  });

  it('captures token usage from message events', async () => {
    const PORT = 19202;
    const app = new Hono();
    app.post('/v1/messages', (c) => {
      const body = sseLines([
        { type: 'message_start', data: { message: { usage: { input_tokens: 42 } } } },
        { type: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'ok' } } },
        { type: 'message_delta', data: { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } } },
        { type: 'message_stop', data: {} },
      ]);
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    await startServer(app, PORT);

    const result = await callSystem2(prompt, makeConfig(PORT));
    for await (const _ of result.stream) { /* drain */ }

    expect(result.usage.input_tokens).toBe(42);
    expect(result.usage.output_tokens).toBe(7);
  });

  it('retries on first failure then succeeds', async () => {
    const PORT = 19203;
    let callCount = 0;
    const app = new Hono();
    app.post('/v1/messages', (c) => {
      callCount++;
      if (callCount === 1) {
        return c.text('Internal Server Error', 500);
      }
      const body = sseLines([
        { type: 'message_start', data: { message: { usage: { input_tokens: 1 } } } },
        { type: 'content_block_delta', data: { index: 0, delta: { type: 'text_delta', text: 'retry ok' } } },
        { type: 'message_delta', data: { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } } },
        { type: 'message_stop', data: {} },
      ]);
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    await startServer(app, PORT);

    const result = await callSystem2(prompt, makeConfig(PORT));
    for await (const _ of result.stream) { /* drain */ }

    expect(callCount).toBe(2);
    expect(result.text).toBe('retry ok');
  });

  it('degrades to hesitate after all retries fail', async () => {
    const PORT = 19204;
    const app = new Hono();
    app.post('/v1/messages', (c) => {
      return c.text('Internal Server Error', 500);
    });
    await startServer(app, PORT);

    const result = await callSystem2(prompt, makeConfig(PORT));
    const chunks: System2StreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(result.text).toBe('...');
    expect(chunks[0].type).toBe('text_delta');
    expect(chunks[0].text).toBe('...');
    expect(chunks[1].type).toBe('stop');
  });

  it('handles unreachable server', async () => {
    // Port 19299 — nothing listening
    const result = await callSystem2(prompt, makeConfig(19299));
    const chunks: System2StreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(result.text).toBe('...');
    expect(result.usage.output_tokens).toBe(1);
  });
});
