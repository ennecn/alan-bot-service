import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { callSystem1 } from '../client.js';
import type { System1Config } from '../client.js';
import type { System1CallParams } from '../types.js';

function makeParams(overrides?: Partial<System1CallParams>): System1CallParams {
  return {
    characterFilter: 'A cheerful AI assistant.',
    emotionState: { joy: 0.5, sadness: 0.2, anger: 0.1, anxiety: 0.2, longing: 0.3, trust: 0.5 },
    eventContent: 'Hello!',
    triggerType: 'user_message',
    wiCandidates: [],
    language: 'en',
    previousImpulse: null,
    oldImpulse: null,
    ...overrides,
  };
}

describe('System 1 integration (mock server)', () => {
  let server: ReturnType<typeof serve>;
  const PORT = 19876;
  const config: System1Config = { baseUrl: `http://127.0.0.1:${PORT}`, model: 'test-model' };

  const app = new Hono();

  app.post('/v1/messages', async (c) => {
    const body = await c.req.json();
    const userMsg = body.messages?.[0]?.content ?? '';

    if (userMsg.includes('TRIGGER_500')) {
      return c.json({ error: 'Internal Server Error' }, 500);
    }

    if (userMsg.includes('TRIGGER_TEXT_ONLY')) {
      return c.json({
        content: [{
          type: 'text',
          text: JSON.stringify({
            event_classification: { type: 'user_message', importance: 0.6 },
            emotional_interpretation: { joy: 0.2 },
            cognitive_projection: 'regex fallback test',
            wi_expansion: [],
            impulse_narrative: 'Regex path.',
            memory_consolidation: { should_save: false, summary: '' },
          }),
        }],
      });
    }

    if (userMsg.includes('TRIGGER_GARBAGE')) {
      return c.json({ content: [{ type: 'text', text: 'no json here at all' }] });
    }

    return c.json({
      content: [{
        type: 'tool_use',
        id: 'toolu_test',
        name: 'process_event',
        input: {
          event_classification: { type: 'user_message', importance: 0.6 },
          emotional_interpretation: { joy: 0.15, trust: 0.1 },
          cognitive_projection: 'The user greeted me warmly.',
          wi_expansion: [],
          impulse_narrative: 'Feeling happy about the greeting.',
          memory_consolidation: { should_save: false, summary: '' },
        },
      }],
    });
  });

  server = serve({ fetch: app.fetch, port: PORT });

  afterAll(() => {
    server.close();
  });

  it('parses tool_use response correctly', async () => {
    const result = await callSystem1(makeParams(), config);
    expect(result).not.toBeNull();
    expect(result!.event_classification.importance).toBe(0.6);
    expect(result!.emotional_interpretation.joy).toBe(0.15);
    expect(result!.emotional_interpretation.trust).toBe(0.1);
    expect(result!.cognitive_projection).toBe('The user greeted me warmly.');
  });

  it('falls back to regex parsing when no tool_use block', async () => {
    const result = await callSystem1(makeParams({ eventContent: 'TRIGGER_TEXT_ONLY' }), config);
    expect(result).not.toBeNull();
    expect(result!.event_classification.importance).toBe(0.6);
    expect(result!.emotional_interpretation.joy).toBe(0.2);
    expect(result!.cognitive_projection).toBe('regex fallback test');
  });

  it('returns null on server error', async () => {
    const result = await callSystem1(makeParams({ eventContent: 'TRIGGER_500' }), config);
    expect(result).toBeNull();
  });

  it('returns null on garbage response', async () => {
    const result = await callSystem1(makeParams({ eventContent: 'TRIGGER_GARBAGE' }), config);
    expect(result).toBeNull();
  });

  it('returns null when server is unreachable', async () => {
    const badConfig: System1Config = { baseUrl: 'http://127.0.0.1:19877', model: 'test' };
    const result = await callSystem1(makeParams(), badConfig);
    expect(result).toBeNull();
  });

  it('clamps emotion deltas to +/-0.3', async () => {
    const result = await callSystem1(makeParams(), config);
    expect(result).not.toBeNull();
    expect(result!.emotional_interpretation.joy).toBeLessThanOrEqual(0.3);
    expect(result!.emotional_interpretation.joy).toBeGreaterThanOrEqual(-0.3);
  });
});
