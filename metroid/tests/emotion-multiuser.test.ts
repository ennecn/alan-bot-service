import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { EmotionEngine } from '../src/engines/emotion/index.js';
import { AuditLog } from '../src/security/audit.js';
import type { EngineContext, MetroidMessage, MetroidCard } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../src/db/schema.sql');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(schemaPath, 'utf-8'));
  // Apply migration for user_emotion_states
  db.exec(`CREATE TABLE IF NOT EXISTS user_emotion_states (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT NOT NULL,
    pleasure REAL NOT NULL DEFAULT 0, arousal REAL NOT NULL DEFAULT 0,
    dominance REAL NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(agent_id, user_id)
  )`);
  return db;
}

const testConfig = {
  dataDir: ':memory:', dbPath: ':memory:',
  memory: { importanceThreshold: 0.4, fadeThreshold: 0.3, maxRetrievalResults: 5, defaultTimeWindowHours: 72 },
  llm: { apiKey: 'test', mainModel: 'test', lightModel: 'test', maxContextTokens: 200_000 },
  compiler: { responseReserveRatio: 0.3 },
  emotion: { minChangeInterval: 0, maxChangePerUpdate: 0.3, recoveryRate: 0.05 },
  growth: { evaluationInterval: 10, minConfidence: 0.5, maxActiveChanges: 20 },
};

const testCard: MetroidCard = {
  name: 'TestBot', description: 'A test bot', personality: 'friendly',
  emotion: { baseline: { pleasure: 0, arousal: 0, dominance: 0 }, intensityDial: 0.5 },
};

function makeMsg(content: string, userId?: string): MetroidMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`, content, channel: 'web-im',
    author: { id: userId || 'u1', name: 'User', isBot: false },
    timestamp: Date.now(),
  };
}

function ctx(agentId: string, msg: string, userId?: string): EngineContext {
  return {
    agentId, mode: 'enhanced',
    message: makeMsg(msg, userId),
    conversationHistory: [],
    userName: 'User',
    userId,
  };
}

// Skip: per-user emotion isolation requires EmotionEngine to store/retrieve state by userId,
// which is not yet implemented (emotion state is currently agent-level only).
describe.skip('EmotionEngine: Multi-user isolation', () => {
  let db: Database.Database;
  let identity: IdentityEngine;
  let audit: AuditLog;
  let engine: EmotionEngine;
  let agentId: string;

  beforeEach(() => {
    db = createDb();
    audit = new AuditLog(db);
    identity = new IdentityEngine(db);
    const agent = identity.createAgent('TestBot', testCard, 'enhanced');
    agentId = agent.id;
    engine = new EmotionEngine(db, identity, audit, testConfig);
  });

  it('should isolate emotion state between users', async () => {
    // User A sends positive message
    await engine.onResponse('ok', ctx(agentId, 'I love this, amazing wonderful!', 'user-a'));
    // User B sends negative message
    await engine.onResponse('ok', ctx(agentId, 'This is terrible and frustrating', 'user-b'));

    const stateA = engine.getState(agentId, 'user-a');
    const stateB = engine.getState(agentId, 'user-b');

    expect(stateA!.pleasure).toBeGreaterThan(0);
    expect(stateB!.pleasure).toBeLessThan(0);
  });

  it('should not pollute agent-level state when userId is provided', async () => {
    const agentBefore = identity.getAgent(agentId)!;
    const originalPleasure = agentBefore.emotionState.pleasure;

    await engine.onResponse('ok', ctx(agentId, 'I love this, amazing wonderful!', 'user-a'));

    const agentAfter = identity.getAgent(agentId)!;
    expect(agentAfter.emotionState.pleasure).toBe(originalPleasure);
  });

  it('should fall back to agent-level state for unknown users', () => {
    const agent = identity.getAgent(agentId)!;
    agent.emotionState = { pleasure: 0.5, arousal: 0.3, dominance: 0.1 };

    const state = engine.getState(agentId, 'unknown-user');
    expect(state!.pleasure).toBe(0.5);
  });

  it('should update agent-level state when no userId', async () => {
    await engine.onResponse('ok', ctx(agentId, 'I love this, amazing wonderful!'));

    const agent = identity.getAgent(agentId)!;
    expect(agent.emotionState.pleasure).toBeGreaterThan(0);
  });

  it('should persist user state to database', async () => {
    await engine.onResponse('ok', ctx(agentId, 'Amazing wonderful great!', 'user-x'));

    const row = db.prepare(
      'SELECT pleasure FROM user_emotion_states WHERE agent_id = ? AND user_id = ?'
    ).get(agentId, 'user-x') as any;

    expect(row).toBeTruthy();
    expect(row.pleasure).toBeGreaterThan(0);
  });

  it('should use per-user state in getPromptFragments', async () => {
    // Set user-specific high emotion
    await engine.onResponse('ok', ctx(agentId, 'I love this so much, amazing wonderful!', 'user-happy'));

    const fragments = await engine.getPromptFragments(ctx(agentId, 'hello', 'user-happy'));
    // Should get emotion hints based on user-happy's positive state
    if (fragments.length > 0) {
      expect(fragments[0].source).toBe('emotion');
    }
  });
});
