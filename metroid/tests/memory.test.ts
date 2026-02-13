import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { MemoryStore } from '../src/engines/memory/store.js';
import { MemoryRetriever } from '../src/engines/memory/retriever.js';
import { createTestDb, createTestAgent } from './helpers.js';

let db: Database.Database;
let store: MemoryStore;
let agentId: string;

beforeEach(() => {
  db = createTestDb();
  store = new MemoryStore(db);
  agentId = createTestAgent(db);
});

describe('MemoryStore', () => {
  it('should create and retrieve a memory', () => {
    const mem = store.create({
      agentId,
      type: 'semantic',
      content: '用户喜欢用TypeScript',
      importance: 0.8,
      confidence: 0.9,
      privacy: 'private',
      keywords: ['TypeScript', '偏好'],
    });

    expect(mem.id).toBeDefined();
    expect(mem.recallCount).toBe(0);

    const fetched = store.getById(mem.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe('用户喜欢用TypeScript');
    expect(fetched!.keywords).toEqual(['TypeScript', '偏好']);
  });

  it('should search by keyword', () => {
    store.create({
      agentId, type: 'semantic', content: 'Mac Mini是主服务器',
      importance: 0.7, confidence: 0.8, privacy: 'public',
      keywords: ['Mac Mini', '服务器'],
    });
    store.create({
      agentId, type: 'episodic', content: '今天部署了新版本',
      importance: 0.5, confidence: 0.7, privacy: 'private',
      keywords: ['部署', '版本'],
    });

    const results = store.searchByKeyword(agentId, 'Mac');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Mac Mini');
  });

  it('should record recall and increment count', () => {
    const mem = store.create({
      agentId, type: 'semantic', content: 'test recall',
      importance: 0.5, confidence: 0.7, privacy: 'private', keywords: ['test'],
    });

    store.recordRecall(mem.id);
    store.recordRecall(mem.id);

    const fetched = store.getById(mem.id);
    expect(fetched!.recallCount).toBe(2);
    expect(fetched!.lastRecalledAt).toBeDefined();
  });

  it('should fade memories and exclude from search', () => {
    const mem = store.create({
      agentId, type: 'semantic', content: 'will be forgotten',
      importance: 0.2, confidence: 0.5, privacy: 'private', keywords: ['forget'],
    });

    store.fade(mem.id);

    const fetched = store.getById(mem.id);
    expect(fetched!.fadedAt).toBeDefined();

    const results = store.searchByKeyword(agentId, 'forget');
    expect(results).toHaveLength(0);
  });

  it('should get recent memories by type', () => {
    store.create({
      agentId, type: 'semantic', content: 'fact 1',
      importance: 0.5, confidence: 0.7, privacy: 'private', keywords: [],
    });
    store.create({
      agentId, type: 'episodic', content: 'event 1',
      importance: 0.5, confidence: 0.7, privacy: 'private', keywords: [],
    });
    store.create({
      agentId, type: 'semantic', content: 'fact 2',
      importance: 0.5, confidence: 0.7, privacy: 'private', keywords: [],
    });

    const semantics = store.getRecent(agentId, 'semantic', 10);
    expect(semantics).toHaveLength(2);
    const contents = semantics.map(m => m.content).sort();
    expect(contents).toEqual(['fact 1', 'fact 2']);
  });
});

describe('MemoryRetriever', () => {
  it('should retrieve by keyword match', async () => {
    const retriever = new MemoryRetriever(store);

    store.create({
      agentId, type: 'semantic', content: '用户的猫叫小花',
      importance: 0.8, confidence: 0.9, privacy: 'private',
      keywords: ['猫', '小花', '宠物'],
    });
    store.create({
      agentId, type: 'semantic', content: '用户住在上海',
      importance: 0.6, confidence: 0.8, privacy: 'private',
      keywords: ['上海', '住址'],
    });

    const results = await retriever.retrieve({ agentId, text: '你还记得我的猫吗' });
    expect(results.length).toBeGreaterThan(0);
    const catMemory = results.find(r => r.memory.content.includes('小花'));
    expect(catMemory).toBeDefined();
  });

  it('should filter by privacy', async () => {
    const retriever = new MemoryRetriever(store);

    store.create({
      agentId, type: 'semantic', content: 'public fact',
      importance: 0.8, confidence: 0.9, privacy: 'public', keywords: ['fact'],
    });
    store.create({
      agentId, type: 'semantic', content: 'sensitive secret',
      importance: 0.9, confidence: 1.0, privacy: 'sensitive', keywords: ['fact'],
    });

    const results = await retriever.retrieve({
      agentId, text: 'tell me a fact', privacyFilter: ['public'],
    });
    expect(results.every(r => r.memory.privacy === 'public')).toBe(true);
  });

  it('should exclude faded memories by default', async () => {
    const retriever = new MemoryRetriever(store);

    const mem = store.create({
      agentId, type: 'semantic', content: 'forgotten thing',
      importance: 0.8, confidence: 0.9, privacy: 'private', keywords: ['forgotten'],
    });
    store.fade(mem.id);

    const results = await retriever.retrieve({ agentId, text: 'forgotten thing' });
    expect(results.find(r => r.memory.id === mem.id)).toBeUndefined();
  });

  it('should include faded when requested', async () => {
    const retriever = new MemoryRetriever(store);

    const mem = store.create({
      agentId, type: 'semantic', content: 'old memory about cats',
      importance: 0.8, confidence: 0.9, privacy: 'private', keywords: ['old', 'cats'],
    });
    store.fade(mem.id);

    const results = await retriever.retrieve({
      agentId, text: 'old cats', includesFaded: true,
    });
    expect(results.find(r => r.memory.id === mem.id)).toBeDefined();
  });
});