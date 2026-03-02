/**
 * Integration test — Full pipeline: event → emotion → impulse → decision → action list.
 * Proves the whole Alan engine works together end-to-end.
 *
 * System 2 is mocked via fetch to return streaming Anthropic SSE responses.
 * System 1 degrades gracefully (no mock needed — uses built-in fallback).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Pipeline } from '../coordinator/pipeline.js';
import { EmotionStateStore } from '../storage/emotion-state.js';
import type { EmotionSnapshot } from '../types/index.js';
import type { AlanConfig } from '../types/actions.js';
import { DEFAULT_WI_WEIGHTS, DEFAULT_WI_ACTIVATION_THRESHOLD } from '../types/actions.js';
import type { CoordinatorEvent } from '../coordinator/types.js';

let tmpDir: string;

function makeConfig(workspacePath: string): AlanConfig {
  return {
    port: 3000,
    workspace_path: workspacePath,
    system1_base_url: 'http://localhost:9999', // S1 always degrades (no mock)
    system2_base_url: 'http://localhost:9998', // Mocked via fetch
    system1_model: 'test-model',
    system2_model: 'test-model',
    embedding_url: 'http://localhost:9999',
    event_bus_url: 'http://localhost:9999',
    event_bus_key: 'test-key',
    agent_id: 'test-agent',
    fire_threshold: 0.6,
    user_message_increment: 0.1,
    session_timeout_hours: 4,
    wi_weights: DEFAULT_WI_WEIGHTS,
    wi_activation_threshold: DEFAULT_WI_ACTIVATION_THRESHOLD,
    s2_max_tokens: 4000,
    character_language: 'en',
  };
}

function seedWorkspace(dir: string): void {
  // Create internal/ for metrics + SQLite
  fs.mkdirSync(path.join(dir, 'internal'), { recursive: true });

  // IDENTITY.md
  fs.writeFileSync(
    path.join(dir, 'IDENTITY.md'),
    '# Identity\nName: Alin\nPersonality: Cheerful, curious, loves cats.\n',
  );

  // Seed emotion_state.md with a known starting state
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const snapshot: EmotionSnapshot = {
    current: { joy: 0.6, sadness: 0.2, anger: 0.1, anxiety: 0.3, longing: 0.4, trust: 0.7 },
    baseline: { joy: 0.5, sadness: 0.2, anger: 0.1, anxiety: 0.2, longing: 0.3, trust: 0.5 },
    suppression: { count: 0, consecutive_hesitate: 0, accumulated: 0, last_suppress: null },
    last_interaction: twoHoursAgo,
    session_start: twoHoursAgo,
  };
  const store = new EmotionStateStore();
  store.write(dir, snapshot);
}

/**
 * Build a mock Anthropic SSE streaming response body.
 * Returns a ReadableStream that yields standard Anthropic SSE events.
 */
function mockS2Stream(text: string, inputTokens = 10, outputTokens = 5): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = text.match(/.{1,10}/g) ?? [text]; // split into 10-char chunks

  return new ReadableStream({
    start(controller) {
      // message_start
      controller.enqueue(encoder.encode(
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: { id: 'msg_mock', type: 'message', role: 'assistant', usage: { input_tokens: inputTokens } },
        })}\n\n`,
      ));

      // content_block_start
      controller.enqueue(encoder.encode(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`,
      ));

      // content_block_delta per chunk
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: chunk },
          })}\n\n`,
        ));
      }

      // content_block_stop
      controller.enqueue(encoder.encode(
        `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      ));

      // message_delta with usage
      controller.enqueue(encoder.encode(
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: outputTokens },
        })}\n\n`,
      ));

      // message_stop
      controller.enqueue(encoder.encode(
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      ));

      controller.close();
    },
  });
}

/**
 * Install a fetch mock that intercepts System 2 calls and returns a streaming response.
 * Passes through all other requests (System 1 will fail normally → degradation).
 */
function mockSystem2Fetch(replyText: string) {
  const originalFetch = globalThis.fetch;
  const mockFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('localhost:9998')) {
      return new Response(mockS2Stream(replyText), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    // Pass through to original fetch (S1 will fail → degradation)
    return originalFetch(input, init);
  });

  globalThis.fetch = mockFn as typeof fetch;
  return { mockFn, restore: () => { globalThis.fetch = originalFetch; } };
}

describe('Integration: full pipeline end-to-end', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-integration-'));
    seedWorkspace(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('processes a user_message event through the full pipeline', async () => {
    const config = makeConfig(tmpDir);
    const pipeline = new Pipeline(config);

    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Hey Alin, do you like cats?',
      timestamp: new Date().toISOString(),
    };

    const result = await pipeline.run(event);

    // 1. ActionList is returned with all required fields
    expect(result).toBeDefined();
    expect(result.decision).toBeDefined();
    expect(['reply', 'suppress', 'hesitate']).toContain(result.decision);
    expect(result.actions).toBeDefined();
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.impulse).toBeDefined();
    expect(result.emotion).toBeDefined();
    expect(result.system1).toBeDefined();
    expect(result.metrics).toBeDefined();

    // 2. Emotion state was updated (written to disk)
    const store = new EmotionStateStore();
    const updatedEmotion = store.read(tmpDir);
    expect(updatedEmotion).not.toBeNull();
    expect(updatedEmotion!.last_interaction).toBe(event.timestamp);

    // Emotion should have decayed toward baseline (2 hours elapsed)
    // With degraded S1, no emotion deltas applied — just decay
    // joy started at 0.6, baseline 0.5 → decayed toward 0.5
    expect(result.metrics.degraded).toBe(true);

    // 3. IMPULSE.md was written
    const impulsePath = path.join(tmpDir, 'IMPULSE.md');
    expect(fs.existsSync(impulsePath)).toBe(true);
    const impulseContent = fs.readFileSync(impulsePath, 'utf-8');
    expect(impulseContent).toContain('value:');
    expect(impulseContent).toContain('fired:');
    expect(impulseContent).toContain('decision:');

    // 4. Impulse components are populated
    expect(result.impulse.value).toBeGreaterThanOrEqual(0);
    expect(result.impulse.value).toBeLessThanOrEqual(1);
    expect(result.impulse.fire_threshold).toBe(0.6);
    expect(result.impulse.components.base_impulse).toBe(0.3);
    expect(result.impulse.components.user_message_increment).toBe(0.1); // 1 unreplied

    // 5. Metrics were written
    const metricsDir = path.join(tmpDir, 'internal');
    const metricsFiles = fs.readdirSync(metricsDir).filter(f => f.startsWith('metrics-'));
    expect(metricsFiles.length).toBe(1);
    const metricsContent = fs.readFileSync(path.join(metricsDir, metricsFiles[0]), 'utf-8');
    const metrics = JSON.parse(metricsContent.trim());
    expect(metrics.trigger).toBe('user_message');
    expect(metrics.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns real reply text from System 2 when impulse fires', async () => {
    const s2Mock = mockSystem2Fetch('I love cats! They are wonderful creatures.');
    try {
      const config = makeConfig(tmpDir);
      config.fire_threshold = 0.5; // Lower threshold to ensure reply
      const pipeline = new Pipeline(config);

      const event: CoordinatorEvent = {
        trigger: 'user_message',
        content: 'Tell me about your day!',
        timestamp: new Date().toISOString(),
      };

      const result = await pipeline.run(event);
      expect(result.decision).toBe('reply');
      expect(result.reply).toBeDefined();

      // Real S2 reply — NOT the old Phase 0 placeholder
      expect(result.reply).not.toContain('Alan Phase 0');
      expect(result.reply).toBe('I love cats! They are wonderful creatures.');
      expect(result.actions[0].type).toBe('reply');
      if (result.actions[0].type === 'reply') {
        expect(result.actions[0].content).toBe('I love cats! They are wonderful creatures.');
      }

      // S2 mock was called
      expect(s2Mock.mockFn).toHaveBeenCalled();

      // Token usage should be populated from S2
      expect(result.metrics.token_usage.s2_in).toBe(10);
      expect(result.metrics.token_usage.s2_out).toBe(5);
      expect(result.metrics.system2_ms).toBeGreaterThanOrEqual(0);
    } finally {
      s2Mock.restore();
    }
  });

  it('provides stream replay for SSE passthrough', async () => {
    const s2Mock = mockSystem2Fetch('Streaming reply here.');
    try {
      const config = makeConfig(tmpDir);
      config.fire_threshold = 0.5;
      const pipeline = new Pipeline(config);

      const event: CoordinatorEvent = {
        trigger: 'user_message',
        content: 'Tell me something!',
        timestamp: new Date().toISOString(),
      };

      const result = await pipeline.run(event);
      expect(result.decision).toBe('reply');
      expect(result.stream).toBeDefined();

      // Consume the replay stream and verify chunks
      const chunks: Array<{ type: string; text?: string }> = [];
      for await (const chunk of result.stream!) {
        chunks.push(chunk);
      }

      // Should have text_delta chunks + a stop chunk
      const textChunks = chunks.filter(c => c.type === 'text_delta');
      expect(textChunks.length).toBeGreaterThan(0);

      // Concatenated text should match the reply
      const streamedText = textChunks.map(c => c.text ?? '').join('');
      expect(streamedText).toBe('Streaming reply here.');

      // Should have a stop chunk with usage
      const stopChunk = chunks.find(c => c.type === 'stop');
      expect(stopChunk).toBeDefined();
    } finally {
      s2Mock.restore();
    }
  });

  it('includes memory consolidation action when S1 reports should_save', async () => {
    // For this test, we mock both S1 and S2
    const originalFetch = globalThis.fetch;
    const mockFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

      if (url.includes('localhost:9999') && url.includes('/v1/messages')) {
        // S1 mock — Anthropic Messages API format with tool_use
        return new Response(JSON.stringify({
          content: [{
            type: 'tool_use',
            name: 'process_event',
            input: {
              event_classification: { type: 'user_message', importance: 0.6 },
              emotional_interpretation: { joy: 0.2 },
              cognitive_projection: 'User is happy about cats',
              wi_expansion: [],
              impulse_narrative: 'Feeling engaged and warm',
              memory_consolidation: { should_save: true, summary: 'User talked about cats' },
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('localhost:9998')) {
        // S2 mock
        return new Response(mockS2Stream('A reply with memory.'), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return originalFetch(input, _init);
    });
    globalThis.fetch = mockFn as typeof fetch;

    try {
      const config = makeConfig(tmpDir);
      config.fire_threshold = 0.5;
      const pipeline = new Pipeline(config);

      const event: CoordinatorEvent = {
        trigger: 'user_message',
        content: 'I love cats so much!',
        timestamp: new Date().toISOString(),
      };

      const result = await pipeline.run(event);

      // S1 was NOT degraded since we mocked it
      expect(result.metrics.degraded).toBe(false);

      // Check that update_memory action is in the action list
      const memoryAction = result.actions.find(a => a.type === 'update_memory');
      expect(memoryAction).toBeDefined();
      if (memoryAction && memoryAction.type === 'update_memory') {
        expect(memoryAction.content).toBe('User talked about cats');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('degrades S2 to hesitate text when S2 is unreachable', async () => {
    const config = makeConfig(tmpDir);
    config.fire_threshold = 0.5; // Ensure reply decision
    // S2 base URL is unreachable (port 9998, no mock)
    const pipeline = new Pipeline(config);

    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Tell me about your day!',
      timestamp: new Date().toISOString(),
    };

    const result = await pipeline.run(event);
    expect(result.decision).toBe('reply');
    // S2 degradation returns '...'
    expect(result.reply).toBe('...');
  });

  it('updates suppression state on suppress decision', async () => {
    // Use a heartbeat trigger with low impulse → should suppress
    const config = makeConfig(tmpDir);
    // Seed emotion with very recent interaction so time_pressure is low
    const recentSnapshot: EmotionSnapshot = {
      current: { joy: 0.5, sadness: 0.2, anger: 0.1, anxiety: 0.2, longing: 0.3, trust: 0.5 },
      baseline: { joy: 0.5, sadness: 0.2, anger: 0.1, anxiety: 0.2, longing: 0.3, trust: 0.5 },
      suppression: { count: 0, consecutive_hesitate: 0, accumulated: 0, last_suppress: null },
      last_interaction: new Date().toISOString(), // just now
      session_start: new Date().toISOString(),
    };
    const store = new EmotionStateStore();
    store.write(tmpDir, recentSnapshot);

    // Lower fire threshold so we can test suppress path
    // With degraded S1 (importance=0.3, no deltas) and heartbeat:
    // base=0.3 + emotion≈0 + supp=0 + time≈0 + event=0.3*0.2=0.06 + msg=0 ≈ 0.36
    config.fire_threshold = 0.9;

    const pipeline = new Pipeline(config);
    const event: CoordinatorEvent = {
      trigger: 'heartbeat',
      content: '',
      timestamp: new Date().toISOString(),
    };

    const result = await pipeline.run(event);
    expect(result.decision).toBe('suppress');
    expect(result.actions[0].type).toBe('suppress');

    // Suppression count should increment
    const updated = store.read(tmpDir);
    expect(updated!.suppression.count).toBe(1);
    expect(updated!.suppression.last_suppress).toBe(event.timestamp);
  });

  it('runs two events sequentially through the mutex', async () => {
    const config = makeConfig(tmpDir);
    const pipeline = new Pipeline(config);

    const event1: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'First message',
      timestamp: new Date().toISOString(),
    };
    const event2: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Second message',
      timestamp: new Date(Date.now() + 1000).toISOString(),
    };

    // Run both concurrently — mutex ensures serial execution
    const [r1, r2] = await Promise.all([pipeline.run(event1), pipeline.run(event2)]);

    expect(r1.decision).toBeDefined();
    expect(r2.decision).toBeDefined();

    // Both should complete without errors
    expect(r1.metrics.trigger).toBe('user_message');
    expect(r2.metrics.trigger).toBe('user_message');

    // The second event should see the updated emotion from the first
    const store = new EmotionStateStore();
    const final = store.read(tmpDir);
    expect(final).not.toBeNull();
    expect(final!.last_interaction).toBe(event2.timestamp);
  });

  it('emotion decays toward baseline over time', async () => {
    const config = makeConfig(tmpDir);

    // Seed with high joy, 10 hours ago
    const oldSnapshot: EmotionSnapshot = {
      current: { joy: 0.9, sadness: 0.1, anger: 0.1, anxiety: 0.1, longing: 0.1, trust: 0.9 },
      baseline: { joy: 0.5, sadness: 0.2, anger: 0.1, anxiety: 0.2, longing: 0.3, trust: 0.5 },
      suppression: { count: 0, consecutive_hesitate: 0, accumulated: 0, last_suppress: null },
      last_interaction: new Date(Date.now() - 10 * 3600_000).toISOString(),
      session_start: new Date(Date.now() - 10 * 3600_000).toISOString(),
    };
    const store = new EmotionStateStore();
    store.write(tmpDir, oldSnapshot);

    const pipeline = new Pipeline(config);
    const event: CoordinatorEvent = {
      trigger: 'heartbeat',
      content: '',
      timestamp: new Date().toISOString(),
    };

    const result = await pipeline.run(event);

    // After 10 hours with half_life=2, decay factor = exp(-10/2) = exp(-5) ≈ 0.0067
    // joy: 0.5 + (0.9 - 0.5) * 0.0067 ≈ 0.503 (no emotion deltas from degraded S1)
    // Should be much closer to baseline than 0.9
    expect(result.emotion.current.joy).toBeLessThan(0.55);
    expect(result.emotion.current.joy).toBeGreaterThan(0.49);

    // trust: 0.5 + (0.9 - 0.5) * 0.0067 ≈ 0.503
    expect(result.emotion.current.trust).toBeLessThan(0.55);
  });

  it('degrades gracefully when System 1 unavailable', async () => {
    const config = makeConfig(tmpDir);
    const pipeline = new Pipeline(config);

    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Hello!',
      timestamp: new Date().toISOString(),
    };

    const result = await pipeline.run(event);

    // S1 is unreachable → degradation
    expect(result.metrics.degraded).toBe(true);
    expect(result.system1.event_classification.importance).toBe(0.3);
    expect(result.system1.emotional_interpretation).toEqual({});
  });

  it('reads card data and passes to prompt assembler', async () => {
    const s2Mock = mockSystem2Fetch('Card-aware reply.');
    try {
      const config = makeConfig(tmpDir);
      config.fire_threshold = 0.5;

      // Write card-data.json
      const cardData = {
        system_prompt: 'You are Alin, a cheerful cat-loving girl.',
        post_history_instructions: 'Stay in character always.',
        mes_example: '<START>\n{{user}}: Hi\n{{char}}: Meow!',
        character_name: 'Alin',
        detected_language: 'en',
      };
      fs.writeFileSync(
        path.join(tmpDir, 'internal', 'card-data.json'),
        JSON.stringify(cardData),
      );

      const pipeline = new Pipeline(config);
      const event: CoordinatorEvent = {
        trigger: 'user_message',
        content: 'Tell me about yourself!',
        timestamp: new Date().toISOString(),
      };

      const result = await pipeline.run(event);
      expect(result.decision).toBe('reply');
      expect(result.reply).toBe('Card-aware reply.');

      // Verify the S2 call was made (card data was passed through assembler)
      expect(s2Mock.mockFn).toHaveBeenCalled();
      // The fetch call body should contain the system prompt from card data
      const s2Call = s2Mock.mockFn.mock.calls.find(
        (call: unknown[]) => {
          const url = typeof call[0] === 'string' ? call[0] : '';
          return url.includes('localhost:9998');
        },
      );
      expect(s2Call).toBeDefined();
      const body = JSON.parse((s2Call![1] as RequestInit).body as string);
      expect(body.system).toContain('cheerful cat-loving girl');
    } finally {
      s2Mock.restore();
    }
  });

  it('applies custom_deltas into custom_state and projects to base emotions', async () => {
    const originalFetch = globalThis.fetch;
    const mockFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

      if (url.includes('localhost:9999') && url.includes('/v1/messages')) {
        return new Response(JSON.stringify({
          content: [{
            type: 'tool_use',
            name: 'process_event',
            input: {
              event_classification: { type: 'heartbeat', importance: 0.3 },
              emotional_interpretation: {},
              custom_deltas: { hello_kitty: 0.3 },
              cognitive_projection: 'Thinking about cute things.',
              wi_expansion: [],
              impulse_narrative: 'Feeling warm.',
              memory_consolidation: { should_save: false, summary: '' },
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return originalFetch(input, _init);
    });
    globalThis.fetch = mockFn as typeof fetch;

    try {
      const config = makeConfig(tmpDir);
      config.fire_threshold = 0.95;
      const pipeline = new Pipeline(config);

      fs.writeFileSync(
        path.join(tmpDir, 'internal', 'card-data.json'),
        JSON.stringify({
          system_prompt: 'Test',
          post_history_instructions: '',
          mes_example: '',
          character_name: 'Alin',
          detected_language: 'en',
          behavioral_engine: {
            schema_version: '1.0',
            custom_emotions: {
              hello_kitty: { range: [0, 1], baseline: 0.2 },
            },
          },
        }),
      );

      const store = new EmotionStateStore();
      const seeded = store.read(tmpDir)!;
      store.write(tmpDir, {
        ...seeded,
        custom_state: { hello_kitty: 0.2 },
      });

      const event: CoordinatorEvent = {
        trigger: 'heartbeat',
        content: '',
        timestamp: new Date().toISOString(),
      };

      const result = await pipeline.run(event);
      expect(result.metrics.degraded).toBe(false);
      expect((result.emotion.custom_state ?? {}).hello_kitty).toBeGreaterThan(0.2);
      const elapsedHours = (
        new Date(event.timestamp).getTime() - new Date(seeded.last_interaction).getTime()
      ) / 3_600_000;
      const expectedNoProjectionJoy = seeded.baseline.joy
        + (seeded.current.joy - seeded.baseline.joy) * Math.exp(-elapsedHours / 2);
      expect(result.emotion.current.joy).toBeGreaterThan(expectedNoProjectionJoy);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses custom projection weights when provided in card config', async () => {
    const originalFetch = globalThis.fetch;
    const mockFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

      if (url.includes('localhost:9999') && url.includes('/v1/messages')) {
        return new Response(JSON.stringify({
          content: [{
            type: 'tool_use',
            name: 'process_event',
            input: {
              event_classification: { type: 'heartbeat', importance: 0.3 },
              emotional_interpretation: {},
              custom_deltas: { focus_mode: 0.3 },
              cognitive_projection: 'Switching to focused mode.',
              wi_expansion: [],
              impulse_narrative: 'Narrowing attention.',
              memory_consolidation: { should_save: false, summary: '' },
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return originalFetch(input, _init);
    });
    globalThis.fetch = mockFn as typeof fetch;

    try {
      const config = makeConfig(tmpDir);
      config.fire_threshold = 0.95;
      const pipeline = new Pipeline(config);

      fs.writeFileSync(
        path.join(tmpDir, 'internal', 'card-data.json'),
        JSON.stringify({
          system_prompt: 'Test',
          post_history_instructions: '',
          mes_example: '',
          character_name: 'Alin',
          detected_language: 'en',
          behavioral_engine: {
            schema_version: '1.0',
            custom_emotions: {
              focus_mode: {
                range: [0, 1],
                baseline: 0.2,
                projection: { anger: 0.8, joy: -0.2 },
              },
            },
          },
        }),
      );

      const store = new EmotionStateStore();
      const seeded = store.read(tmpDir)!;
      store.write(tmpDir, {
        ...seeded,
        custom_state: { focus_mode: 0.2 },
      });

      const event: CoordinatorEvent = {
        trigger: 'heartbeat',
        content: '',
        timestamp: new Date().toISOString(),
      };

      const result = await pipeline.run(event);
      const elapsedHours = (
        new Date(event.timestamp).getTime() - new Date(seeded.last_interaction).getTime()
      ) / 3_600_000;
      const noProjAnger = seeded.baseline.anger
        + (seeded.current.anger - seeded.baseline.anger) * Math.exp(-elapsedHours / 2);
      const noProjJoy = seeded.baseline.joy
        + (seeded.current.joy - seeded.baseline.joy) * Math.exp(-elapsedHours / 2);

      expect(result.emotion.current.anger).toBeGreaterThan(noProjAnger);
      expect(result.emotion.current.joy).toBeLessThan(noProjJoy);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
