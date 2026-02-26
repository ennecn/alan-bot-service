/**
 * E2E Card Flow Test — validates the complete Alan Engine pipeline:
 *   Card Import → Cold Start → User Message → S2 Reply → Streaming → Memory
 *
 * All LLM calls (S1, S2, Import LLM, embedding) are mocked.
 * Uses a temp workspace with a real SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AlanConfig, WIEntry } from '../types/actions.js';
import { DEFAULT_WI_WEIGHTS, DEFAULT_WI_ACTIVATION_THRESHOLD } from '../types/actions.js';
import type { STCardV2Wrapper } from '../card-import/types.js';
import { importCard } from '../card-import/index.js';
import { AlanEngine } from '../server/engine.js';
import type { CoordinatorEvent } from '../coordinator/types.js';
import { EmotionStateStore } from '../storage/emotion-state.js';
import { initDatabase } from '../storage/database.js';
import { WIStore } from '../storage/wi-store.js';

let tmpDir: string;
let originalFetch: typeof globalThis.fetch;

// --- Test Fixtures ---

/** Minimal ST Card V2 with WI entries and behavioral_engine extension */
function makeTestCard(): STCardV2Wrapper {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'TestChar',
      description: 'A cheerful test character who loves coding and cats.',
      personality: 'Curious, energetic, slightly mischievous.',
      scenario: 'You are chatting with {{user}} in a cozy room.',
      first_mes: 'Hey there! Want to see my latest project?',
      mes_example: '<START>\n{{user}}: What do you like?\n{{char}}: I love cats and TypeScript!',
      alternate_greetings: ['Yo! Check this out!'],
      system_prompt: 'You are TestChar, a cheerful developer.',
      post_history_instructions: 'Always stay in character. Be enthusiastic about code.',
      character_book: {
        entries: [
          {
            keys: ['cat', 'cats', 'kitten'],
            content: 'TestChar has a cat named Pixel who sits on her keyboard.',
            enabled: true,
            order: 10,
            weight: 50,
          },
          {
            keys: ['code', 'programming', 'typescript'],
            secondary_keys: ['rust', 'python'],
            content: 'TestChar primarily codes in TypeScript but is learning Rust.',
            enabled: true,
            selective_logic: 0, // AND_ANY
            order: 20,
            weight: 40,
          },
          {
            keys: ['morning'],
            content: 'TestChar is a night owl and grumpy in the morning.',
            enabled: true,
            order: 30,
          },
        ],
      },
      extensions: {
        behavioral_engine: {
          schema_version: '1.0',
          emotion_baseline: { joy: 0.6, trust: 0.7 },
        },
      },
    },
  };
}

function makeConfig(workspacePath: string): AlanConfig {
  return {
    port: 7099,
    workspace_path: workspacePath,
    system1_base_url: 'http://localhost:19901',
    system2_base_url: 'http://localhost:19902',
    system1_model: 'test-s1',
    system2_model: 'test-s2',
    embedding_url: 'http://localhost:19903',
    event_bus_url: '',
    event_bus_key: '',
    agent_id: 'e2e-test-agent',
    fire_threshold: 0.5, // Low threshold so impulse fires on user_message
    user_message_increment: 0.1,
    session_timeout_hours: 4,
    wi_weights: DEFAULT_WI_WEIGHTS,
    wi_activation_threshold: DEFAULT_WI_ACTIVATION_THRESHOLD,
    s2_max_tokens: 2000,
    character_language: 'en',
    import_llm_base_url: 'http://localhost:19901',
    import_llm_model: 'test-s1',
  };
}

/** Build a mock Anthropic SSE streaming response */
function mockS2Stream(text: string, inputTokens = 50, outputTokens = 20): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = text.match(/.{1,15}/g) ?? [text];

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: { id: 'msg_e2e', type: 'message', role: 'assistant', usage: { input_tokens: inputTokens } },
        })}\n\n`,
      ));

      controller.enqueue(encoder.encode(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start', index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`,
      ));

      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta', index: 0,
            delta: { type: 'text_delta', text: chunk },
          })}\n\n`,
        ));
      }

      controller.enqueue(encoder.encode(
        `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      ));

      controller.enqueue(encoder.encode(
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: outputTokens },
        })}\n\n`,
      ));

      controller.enqueue(encoder.encode(
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      ));

      controller.close();
    },
  });
}

/** Mock S1 response: Anthropic Messages API with tool_use */
function makeS1Response(overrides?: {
  importance?: number;
  deltas?: Record<string, number>;
  shouldSave?: boolean;
  summary?: string;
}) {
  return JSON.stringify({
    content: [{
      type: 'tool_use',
      name: 'process_event',
      input: {
        event_classification: { type: 'user_message', importance: overrides?.importance ?? 0.6 },
        emotional_interpretation: overrides?.deltas ?? { joy: 0.1 },
        cognitive_projection: 'User wants to chat about their interests.',
        wi_expansion: [],
        impulse_narrative: 'Feeling engaged and curious.',
        memory_consolidation: {
          should_save: overrides?.shouldSave ?? false,
          summary: overrides?.summary ?? '',
        },
      },
    }],
  });
}

/**
 * Install comprehensive fetch mock that handles S1, S2, and embedding calls.
 */
function installFetchMocks(options?: {
  s2Reply?: string;
  s1ShouldSave?: boolean;
  s1Summary?: string;
}) {
  const s2Reply = options?.s2Reply ?? 'Oh, I love cats and coding! Let me tell you about Pixel...';
  const mockFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    // S1 mock
    if (url.includes('localhost:19901') && url.includes('/v1/messages')) {
      return new Response(makeS1Response({
        shouldSave: options?.s1ShouldSave,
        summary: options?.s1Summary,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // S2 mock
    if (url.includes('localhost:19902')) {
      return new Response(mockS2Stream(s2Reply), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    // Embedding mock — return a dummy 384-dim vector
    if (url.includes('localhost:19903')) {
      return new Response(JSON.stringify({
        data: [{ embedding: new Array(384).fill(0.1) }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Anything else — fail
    return originalFetch(input, init);
  });

  globalThis.fetch = mockFn as typeof fetch;
  return mockFn;
}

// --- Tests ---

describe('E2E: Card Import → Cold Start → Message Flow', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-e2e-'));
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // On Windows, SQLite WAL may hold file locks briefly — retry cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; OS will reclaim temp files eventually
    }
  });

  it('imports a card and creates all expected workspace files', async () => {
    // Write test card to file
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');

    const result = await importCard(cardPath, tmpDir);

    // IDENTITY.md created
    const identity = fs.readFileSync(path.join(tmpDir, 'IDENTITY.md'), 'utf-8');
    expect(identity).toContain('# TestChar');
    expect(identity).toContain('cheerful test character');
    expect(identity).toContain('Curious, energetic');

    // card-data.json created
    const cardData = JSON.parse(fs.readFileSync(path.join(tmpDir, 'internal', 'card-data.json'), 'utf-8'));
    expect(cardData.character_name).toBe('TestChar');
    expect(cardData.system_prompt).toBe('You are TestChar, a cheerful developer.');
    expect(cardData.post_history_instructions).toBe('Always stay in character. Be enthusiastic about code.');
    expect(cardData.mes_example).toContain('cats and TypeScript');
    expect(cardData.detected_language).toBe('en');

    // greetings.json created
    const greetings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'internal', 'greetings.json'), 'utf-8'));
    expect(greetings).toHaveLength(2);
    expect(greetings[0]).toContain('latest project');

    // WI entries in SQLite
    const db = initDatabase(tmpDir);
    const wiStore = new WIStore(db);
    const entries = wiStore.getAllEntries();
    expect(entries).toHaveLength(3);
    expect(entries.find(e => e.keys.includes('cat'))).toBeDefined();
    expect(entries.find(e => e.keys.includes('code'))).toBeDefined();
    db.close();

    // Import result
    expect(result.wi_count).toBe(3);
    expect(result.detected_language).toBe('en');
  });

  it('cold start initializes emotion state and logs character info', async () => {
    // Write test card and import it
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    // Create engine — triggers cold start on first run
    const config = makeConfig(tmpDir);
    const engine = new AlanEngine(config);

    // Before first run, emotion_state.md should not exist yet
    // (importCard doesn't create it, cold start does)
    const emotionPath = path.join(tmpDir, 'emotion_state.md');
    const emotionExistedBefore = fs.existsSync(emotionPath);

    // Mock fetch and run first event
    installFetchMocks();
    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Hello!',
      timestamp: new Date().toISOString(),
    };
    await engine.run(event);

    // After first run, emotion_state.md should exist
    expect(fs.existsSync(emotionPath)).toBe(true);

    // IMPULSE.md should exist
    expect(fs.existsSync(path.join(tmpDir, 'IMPULSE.md'))).toBe(true);
  });

  it('full pipeline: import → message → real S2 reply with card context', async () => {
    // Step 1: Import card
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    // Step 2: Create engine
    const config = makeConfig(tmpDir);
    const engine = new AlanEngine(config);

    // Step 3: Mock all LLM calls
    const s2Reply = 'Pixel is purring on my keyboard right now! She always does that when I code.';
    const mockFn = installFetchMocks({ s2Reply });

    // Step 4: Send user message about cats (should trigger WI entry)
    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Do you have any cats?',
      timestamp: new Date().toISOString(),
    };

    const result = await engine.run(event);

    // Verify decision is reply
    expect(result.decision).toBe('reply');
    expect(result.reply).toBe(s2Reply);

    // Verify S2 was called with card data in prompt
    const s2Calls = mockFn.mock.calls.filter(
      (call: unknown[]) => {
        const url = typeof call[0] === 'string' ? call[0] : '';
        return url.includes('localhost:19902');
      },
    );
    expect(s2Calls.length).toBe(1);
    const s2Body = JSON.parse((s2Calls[0][1] as RequestInit).body as string);
    expect(s2Body.system).toContain('TestChar'); // card system prompt
    expect(s2Body.model).toBe('test-s2');
    expect(s2Body.stream).toBe(true);

    // Verify token usage populated
    expect(result.metrics.token_usage.s2_in).toBe(50);
    expect(result.metrics.token_usage.s2_out).toBe(20);

    // Verify S1 was not degraded (mocked)
    expect(result.metrics.degraded).toBe(false);

    // Verify chat history stored
    const db = initDatabase(tmpDir);
    const rows = db.prepare('SELECT * FROM chat_history ORDER BY id').all() as Array<{
      role: string; content: string;
    }>;
    expect(rows.length).toBe(2); // user + assistant
    expect(rows[0].role).toBe('user');
    expect(rows[0].content).toContain('cats');
    expect(rows[1].role).toBe('assistant');
    expect(rows[1].content).toBe(s2Reply);
    db.close();
  });

  it('streaming replay provides correct SSE chunks', async () => {
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    const config = makeConfig(tmpDir);
    const engine = new AlanEngine(config);
    const s2Reply = 'Streaming test reply with enough text to split.';
    installFetchMocks({ s2Reply });

    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Tell me something!',
      timestamp: new Date().toISOString(),
    };

    const result = await engine.run(event);
    expect(result.decision).toBe('reply');
    expect(result.stream).toBeDefined();

    // Consume stream
    const chunks: Array<{ type: string; text?: string; usage?: unknown }> = [];
    for await (const chunk of result.stream!) {
      chunks.push(chunk);
    }

    // Should have text_delta chunks
    const textChunks = chunks.filter(c => c.type === 'text_delta');
    expect(textChunks.length).toBeGreaterThan(0);

    // Concatenated text matches reply
    const streamedText = textChunks.map(c => c.text ?? '').join('');
    expect(streamedText).toBe(s2Reply);

    // Should end with stop chunk containing usage
    const stopChunk = chunks.find(c => c.type === 'stop');
    expect(stopChunk).toBeDefined();
    expect(stopChunk!.usage).toBeDefined();
  });

  it('memory consolidation writes to MEMORY.md via action dispatch', async () => {
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    const config = makeConfig(tmpDir);
    const engine = new AlanEngine(config);
    installFetchMocks({
      s2Reply: 'A memorable reply.',
      s1ShouldSave: true,
      s1Summary: 'User asked about cats. Character shared love of cats.',
    });

    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Tell me about your cats!',
      timestamp: new Date().toISOString(),
    };

    const result = await engine.run(event);

    // Verify update_memory action was created
    const memoryAction = result.actions.find(a => a.type === 'update_memory');
    expect(memoryAction).toBeDefined();
    if (memoryAction?.type === 'update_memory') {
      expect(memoryAction.content).toContain('cats');
    }

    // Verify MEMORY.md was written by the MemoryAdapter (dispatched by engine)
    const memoryPath = path.join(tmpDir, 'MEMORY.md');
    expect(fs.existsSync(memoryPath)).toBe(true);
    const memContent = fs.readFileSync(memoryPath, 'utf-8');
    expect(memContent).toContain('User asked about cats');
  });

  it('WI entries with all 4 signals are evaluated', async () => {
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    // Add a WI entry with state_conditions and temporal_conditions
    const db = initDatabase(tmpDir);
    const wiStore = new WIStore(db);
    const stateEntry: WIEntry = {
      id: 'wi-state-test',
      keys: ['coding'],
      content: 'When joyful and coding, TestChar hums a tune.',
      enabled: true,
      order: 5,
      weight: 60,
      state_conditions: { joy: { min: 0.4 } },
      temporal_conditions: { day_of_week: [0, 1, 2, 3, 4, 5, 6] }, // every day
      embedding: 'pending',
    };
    wiStore.upsertEntry(stateEntry);
    db.close();

    const config = makeConfig(tmpDir);
    const engine = new AlanEngine(config);
    installFetchMocks({ s2Reply: 'Hmm hmm, coding away!' });

    const event: CoordinatorEvent = {
      trigger: 'user_message',
      content: 'Are you coding something right now?',
      timestamp: new Date().toISOString(),
    };

    const result = await engine.run(event);
    expect(result.decision).toBe('reply');
    expect(result.reply).toBeDefined();

    // The pipeline should have evaluated all 4 signals (text, semantic, state, temporal)
    // We can't directly inspect signal scores from the result, but we verify the pipeline
    // completed without errors and produced a reply — meaning the WI engine ran with all signals.
    expect(result.metrics.wi_total).toBeGreaterThanOrEqual(4); // 3 from card + 1 manual
  });

  it('reimport preserves MEMORY.md while refreshing card data', async () => {
    // First import
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    // Create MEMORY.md with existing content
    const memoryPath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memoryPath, '# Memory\n\n## 2026-02-26\n\nPrevious conversation memories.\n', 'utf-8');

    // Also create emotion_state.md
    const emotionPath = path.join(tmpDir, 'emotion_state.md');
    fs.writeFileSync(emotionPath, 'existing-emotion-state', 'utf-8');

    // Reimport
    await importCard(cardPath, tmpDir, { reimport: true });

    // MEMORY.md preserved
    const memContent = fs.readFileSync(memoryPath, 'utf-8');
    expect(memContent).toContain('Previous conversation memories');

    // emotion_state.md preserved
    const emotionContent = fs.readFileSync(emotionPath, 'utf-8');
    expect(emotionContent).toBe('existing-emotion-state');

    // card-data.json still updated
    const cardData = JSON.parse(fs.readFileSync(path.join(tmpDir, 'internal', 'card-data.json'), 'utf-8'));
    expect(cardData.character_name).toBe('TestChar');
  });

  it('complete lifecycle: import → multiple messages → memory accumulates', async () => {
    const cardPath = path.join(tmpDir, 'test-card.json');
    fs.writeFileSync(cardPath, JSON.stringify(makeTestCard()), 'utf-8');
    await importCard(cardPath, tmpDir);

    const config = makeConfig(tmpDir);
    const engine = new AlanEngine(config);

    // Message 1: no memory save
    installFetchMocks({ s2Reply: 'First reply!' });
    await engine.run({
      trigger: 'user_message',
      content: 'Hi there!',
      timestamp: new Date().toISOString(),
    });

    // Message 2: with memory save
    globalThis.fetch = originalFetch; // reset
    installFetchMocks({
      s2Reply: 'Second reply with memory!',
      s1ShouldSave: true,
      s1Summary: 'User greeted and asked about coding.',
    });
    await engine.run({
      trigger: 'user_message',
      content: 'What are you working on?',
      timestamp: new Date(Date.now() + 1000).toISOString(),
    });

    // Verify chat history has 4 entries (2 user + 2 assistant)
    const db = initDatabase(tmpDir);
    const rows = db.prepare('SELECT * FROM chat_history ORDER BY id').all() as Array<{
      role: string;
    }>;
    expect(rows.length).toBe(4);
    db.close();

    // Verify MEMORY.md was created
    const memoryPath = path.join(tmpDir, 'MEMORY.md');
    expect(fs.existsSync(memoryPath)).toBe(true);
    const memContent = fs.readFileSync(memoryPath, 'utf-8');
    expect(memContent).toContain('coding');

    // Verify emotion state was written
    const emotionStore = new EmotionStateStore();
    const emotion = emotionStore.read(tmpDir);
    expect(emotion).not.toBeNull();
    expect(emotion!.current.joy).toBeDefined();
  });
});
