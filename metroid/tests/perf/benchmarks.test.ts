import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MemoryStore } from '../../src/engines/memory/store.js';
import { MemoryRetriever } from '../../src/engines/memory/retriever.js';
import { SessionCache } from '../../src/engines/memory/session-cache.js';
import { PromptCompiler } from '../../src/compiler/index.js';
import { defaultConfig } from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../../src/db/schema.sql');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(schemaPath, 'utf-8'));
  return db;
}

function createAgent(db: Database.Database, name: string): string {
  const id = `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO agents (id, name, card_json) VALUES (?, ?, '{}')`).run(id, name);
  return id;
}

describe('Performance Benchmarks', () => {
  let db: Database.Database;
  let store: MemoryStore;
  let agentId: string;

  beforeEach(() => {
    db = createDb();
    store = new MemoryStore(db);
    agentId = createAgent(db, 'perf-agent');
  });

  afterEach(() => db.close());

  it('memory insertion: 1000 memories under 500ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      store.create({
        agentId,
        type: 'episodic',
        content: `Memory content #${i} with some text about topic ${i % 50}`,
        importance: Math.random(),
        confidence: 0.8,
        privacy: 'public',
        keywords: [`topic${i % 50}`, `kw${i % 20}`],
      });
    }
    const elapsed = performance.now() - t0;
    console.log(`  1000 memory inserts: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(500);
  });

  it('keyword retrieval: 1000 memories, search under 50ms', async () => {
    // Seed 1000 memories
    for (let i = 0; i < 1000; i++) {
      store.create({
        agentId,
        type: 'episodic',
        content: `记忆内容 #${i} 关于话题 ${i % 50}`,
        importance: Math.random(),
        confidence: 0.8,
        privacy: 'public',
        keywords: [`话题${i % 50}`, `关键词${i % 20}`],
      });
    }

    const retriever = new MemoryRetriever(store);
    const t0 = performance.now();
    const results = await retriever.retrieve({
      agentId,
      text: '话题5 关键词10',
      limit: 10,
    });
    const elapsed = performance.now() - t0;
    console.log(`  Keyword retrieval (1000 memories): ${elapsed.toFixed(1)}ms, ${results.length} results`);
    expect(elapsed).toBeLessThan(50);
    expect(results.length).toBeGreaterThan(0);
  });

  it('session cache: L1 load under 20ms for 1000 memories', () => {
    // Seed 1000 memories with varying importance
    for (let i = 0; i < 1000; i++) {
      store.create({
        agentId,
        type: i % 3 === 0 ? 'semantic' : 'episodic',
        content: `Content #${i}`,
        importance: 0.3 + Math.random() * 0.7,
        confidence: 0.8,
        privacy: 'public',
        keywords: [`kw${i}`],
      });
    }

    const cache = new SessionCache({ ttlMs: 60_000, maxPerAgent: 30 });
    const t0 = performance.now();
    const cached = cache.get(agentId, store);
    const elapsed = performance.now() - t0;
    console.log(`  SessionCache L1 load: ${elapsed.toFixed(1)}ms, ${cached.length} memories cached`);
    expect(elapsed).toBeLessThan(20);
    expect(cached.length).toBeGreaterThan(0);
    expect(cached.length).toBeLessThanOrEqual(30);

    // Second access should be instant (from cache)
    const t1 = performance.now();
    cache.get(agentId, store);
    const elapsed2 = performance.now() - t1;
    console.log(`  SessionCache L1 hit: ${elapsed2.toFixed(3)}ms`);
    expect(elapsed2).toBeLessThan(1);
  });

  it('prompt compilation: 20 fragments under 5ms', () => {
    const compiler = new PromptCompiler(defaultConfig);
    const fragments = Array.from({ length: 20 }, (_, i) => ({
      source: ['identity', 'memory', 'emotion', 'world', 'growth'][i % 5],
      content: `Fragment ${i}: ${'x'.repeat(200)}`,
      priority: 50 + (i % 30),
      tokens: 60,
      required: i < 3,
    }));

    // Register a mock engine that returns our fragments
    compiler.registerEngine({
      name: 'mock',
      getPromptFragments: async () => fragments,
    });

    const base = '你正在扮演测试角色。';
    const context = {
      agentId: 'test',
      mode: 'enhanced' as const,
      message: { id: 'msg1', channel: 'web-im' as const, author: { id: 'u1', name: 'User', isBot: false }, content: 'hello', timestamp: Date.now() },
      conversationHistory: [],
    };

    // Warm up
    compiler.compileWithDetails(base, context);

    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      compiler.compileWithDetails(base, context);
    }
    const elapsed = (performance.now() - t0) / 100;
    console.log(`  Prompt compilation (20 frags): ${elapsed.toFixed(2)}ms avg`);
    expect(elapsed).toBeLessThan(5);
  });

  it('token estimation: 10000 calls under 100ms', () => {
    const compiler = new PromptCompiler(defaultConfig);
    const texts = [
      '这是一段中文测试文本，包含各种字符。',
      'This is an English test string with various words.',
      '混合 mixed 文本 text 123 测试！',
      'A'.repeat(500),
      '你'.repeat(500),
    ];

    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      compiler.estimateTokens(texts[i % texts.length]);
    }
    const elapsed = performance.now() - t0;
    console.log(`  Token estimation (10k calls): ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it('memory growth: 10k inserts maintain consistent performance', () => {
    const batchSize = 1000;
    const batches = 10;
    const timings: number[] = [];

    for (let b = 0; b < batches; b++) {
      const t0 = performance.now();
      for (let i = 0; i < batchSize; i++) {
        const idx = b * batchSize + i;
        store.create({
          agentId,
          type: 'episodic',
          content: `Memory #${idx}`,
          importance: Math.random(),
          confidence: 0.8,
          privacy: 'public',
          keywords: [`kw${idx % 100}`],
        });
      }
      timings.push(performance.now() - t0);
    }

    console.log(`  10k memory inserts by batch: ${timings.map(t => t.toFixed(0) + 'ms').join(', ')}`);
    // Last batch should not be more than 3x slower than first
    expect(timings[timings.length - 1]).toBeLessThan(timings[0] * 3 + 50);
  });

  it('concurrent agent isolation: 5 agents, no cross-contamination', async () => {
    const agents = Array.from({ length: 5 }, (_, i) => createAgent(db, `agent-${i}`));

    // Each agent gets unique memories
    for (const aid of agents) {
      for (let i = 0; i < 100; i++) {
        store.create({
          agentId: aid,
          type: 'episodic',
          content: `${aid} memory #${i}`,
          importance: 0.7,
          confidence: 0.8,
          privacy: 'public',
          keywords: ['shared-keyword'],
        });
      }
    }

    const retriever = new MemoryRetriever(store);
    const t0 = performance.now();
    const results = await Promise.all(
      agents.map(aid => retriever.retrieve({ agentId: aid, text: 'shared-keyword', limit: 10 }))
    );
    const elapsed = performance.now() - t0;
    console.log(`  5-agent parallel retrieval: ${elapsed.toFixed(1)}ms`);

    // Each agent should only get their own memories
    for (let i = 0; i < agents.length; i++) {
      for (const r of results[i]) {
        expect(r.memory.agentId).toBe(agents[i]);
      }
    }
  });
});
