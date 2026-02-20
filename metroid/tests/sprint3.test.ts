import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SessionEngine } from '../src/engines/session/index.js';
import { FeedEngine } from '../src/engines/feed/index.js';
import { ConversationEngine } from '../src/engines/conversation/index.js';
import { ConflictArbiter } from '../src/engines/memory/conflict.js';
import { MemoryStore } from '../src/engines/memory/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../src/db/schema.sql');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(schemaPath, 'utf-8'));
  // Apply Sprint 3 migrations (tables not in schema.sql)
  applyMigrations(db);
  return db;
}

function applyMigrations(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT, summary TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, author_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS feed_entries (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL,
    type TEXT NOT NULL, content TEXT NOT NULL, source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, agent_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
    agent_id TEXT, user_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL,
    author_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function createAgent(db: Database.Database, name: string): string {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO agents (id, name, card_json) VALUES (?, ?, '{}')`).run(id, name);
  return id;
}

describe('Sprint 3: Phase 5 Features', () => {
  let db: Database.Database;
  let agentId: string;

  beforeEach(() => {
    db = createDb();
    agentId = createAgent(db, 'test-agent');
  });
  afterEach(() => db.close());

  // === P5-7: Session Engine ===
  describe('SessionEngine', () => {
    it('should create a session and record messages', () => {
      const engine = new SessionEngine(db);
      const { session } = engine.startSession(agentId);
      expect(session.id).toBeTruthy();
      expect(session.agentId).toBe(agentId);

      engine.addMessage(session.id, 'user', 'Hello!', 'User');
      engine.addMessage(session.id, 'assistant', 'Hi there!');

      const messages = engine.getMessages(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should load previous session context for continuity', () => {
      const engine = new SessionEngine(db);

      // First session
      const { session: s1 } = engine.startSession(agentId);
      engine.addMessage(s1.id, 'user', 'Message 1');
      engine.addMessage(s1.id, 'assistant', 'Reply 1');
      engine.addMessage(s1.id, 'user', 'Message 2');
      engine.addMessage(s1.id, 'assistant', 'Reply 2');
      engine.endSession(s1.id, 'First session');

      // Second session should get previous context
      const { session: s2, previousContext } = engine.startSession(agentId);
      expect(s2.id).not.toBe(s1.id);
      expect(previousContext.length).toBe(4);
      const contents = previousContext.map(m => m.content);
      expect(contents).toContain('Message 1');
      expect(contents).toContain('Reply 2');
    });

    it('should list sessions for an agent', () => {
      const engine = new SessionEngine(db);
      engine.startSession(agentId);
      engine.startSession(agentId);
      const sessions = engine.listSessions(agentId);
      expect(sessions).toHaveLength(2);
    });
  });

  // === P5-2: Feed Engine ===
  describe('FeedEngine', () => {
    it('should create and retrieve feed entries', () => {
      const feed = new FeedEngine(db);
      feed.create(agentId, 'mood', '心情很好！', 'emotion');
      feed.create(agentId, 'thought', '在想一些事情...', 'memory');

      const entries = feed.getFeed(agentId);
      expect(entries).toHaveLength(2);
      // Both created at same instant, order by DESC so last inserted first
      const types = entries.map(e => e.type);
      expect(types).toContain('mood');
      expect(types).toContain('thought');
    });

    it('should generate mood entries from emotion state', () => {
      const feed = new FeedEngine(db);
      const entries = feed.generateFromState(agentId, {
        emotion: { pleasure: 0.7, arousal: 0.5, dominance: 0.3 },
      });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].type).toBe('mood');
    });

    it('should rate-limit feed generation', () => {
      const feed = new FeedEngine(db);
      // Generate 5 entries (max per hour)
      for (let i = 0; i < 5; i++) {
        feed.create(agentId, 'mood', `Entry ${i}`);
      }
      // Next generation should be empty due to rate limit
      const entries = feed.generateFromState(agentId, {
        emotion: { pleasure: 0.8, arousal: 0.6, dominance: 0.3 },
      });
      expect(entries).toHaveLength(0);
    });
  });

  // === P5-1: Conversation Engine ===
  describe('ConversationEngine', () => {
    let agent2Id: string;

    beforeEach(() => {
      agent2Id = createAgent(db, 'agent-2');
    });

    it('should create a conversation with participants', () => {
      const engine = new ConversationEngine(db);
      const conv = engine.create('Test Chat', 'user-1', [agentId, agent2Id]);
      expect(conv.participants).toHaveLength(2);
      expect(conv.title).toBe('Test Chat');
    });

    it('should add and retrieve messages', () => {
      const engine = new ConversationEngine(db);
      const conv = engine.create(undefined, 'user-1', [agentId]);

      engine.addMessage(conv.id, { userId: 'u1', role: 'user', content: 'Hello', authorName: 'User' });
      engine.addMessage(conv.id, { agentId, role: 'assistant', content: 'Hi!', authorName: 'Agent' });

      const messages = engine.getMessages(conv.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].agentId).toBe(agentId);
    });

    it('should select next speaker based on mention', () => {
      const engine = new ConversationEngine(db);
      const conv = engine.create(undefined, 'user-1', [agentId, agent2Id]);

      const names = new Map([[agentId, 'Alice'], [agent2Id, 'Bob']]);
      const speaker = engine.selectNextSpeaker(conv.id, [agentId, agent2Id], 'Hey Bob, what do you think?', names);
      expect(speaker).toBe(agent2Id);
    });

    it('should round-robin when no mention', () => {
      const engine = new ConversationEngine(db);
      const conv = engine.create(undefined, 'user-1', [agentId, agent2Id]);

      // Agent 1 spoke last
      engine.addMessage(conv.id, { agentId, role: 'assistant', content: 'I said something' });

      const names = new Map([[agentId, 'Alice'], [agent2Id, 'Bob']]);
      const speaker = engine.selectNextSpeaker(conv.id, [agentId, agent2Id], 'What do you all think?', names);
      expect(speaker).toBe(agent2Id); // agent2 hasn't spoken yet
    });

    it('should list conversations', () => {
      const engine = new ConversationEngine(db);
      engine.create('Chat 1', 'user-1', [agentId]);
      engine.create('Chat 2', 'user-1', [agentId, agent2Id]);

      const convs = engine.list();
      expect(convs).toHaveLength(2);
    });
  });

  // === P5-3: Memory Conflict Arbitration ===
  describe('ConflictArbiter', () => {
    it('should detect conflicting memories with negation', () => {
      const store = new MemoryStore(db);
      const arbiter = new ConflictArbiter();

      const m1 = store.create({
        agentId, type: 'semantic', content: '用户喜欢猫',
        importance: 0.8, confidence: 0.9, privacy: 'public',
        keywords: ['用户', '喜欢', '猫'],
      });
      const m2 = store.create({
        agentId, type: 'semantic', content: '用户不喜欢猫',
        importance: 0.7, confidence: 0.6, privacy: 'public',
        keywords: ['用户', '喜欢', '猫'],
      });

      const scored = [
        { memory: m1, score: 0.9, matchReason: 'keyword' },
        { memory: m2, score: 0.8, matchReason: 'keyword' },
      ];

      const conflicts = arbiter.arbitrate(scored, store);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].winner.id).toBe(m1.id); // higher confidence
      expect(conflicts[0].loser.confidence).toBeCloseTo(0.3); // 0.6 * 0.5
    });

    it('should not flag non-conflicting memories', () => {
      const store = new MemoryStore(db);
      const arbiter = new ConflictArbiter();

      const m1 = store.create({
        agentId, type: 'semantic', content: '用户喜欢猫',
        importance: 0.8, confidence: 0.9, privacy: 'public',
        keywords: ['用户', '猫'],
      });
      const m2 = store.create({
        agentId, type: 'semantic', content: '用户也喜欢狗',
        importance: 0.7, confidence: 0.8, privacy: 'public',
        keywords: ['用户', '狗'],
      });

      const scored = [
        { memory: m1, score: 0.9, matchReason: 'keyword' },
        { memory: m2, score: 0.8, matchReason: 'keyword' },
      ];

      const conflicts = arbiter.arbitrate(scored, store);
      expect(conflicts).toHaveLength(0);
    });
  });
});
