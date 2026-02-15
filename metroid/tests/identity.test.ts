import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { IdentityEngine } from '../src/engines/identity/index.js';
import type { MetroidCard, EngineContext } from '../src/types.js';
import { createTestDb } from './helpers.js';

let db: Database.Database;
let identity: IdentityEngine;

const testCard: MetroidCard = {
  name: '小凛',
  description: '活泼开朗的AI助手',
  personality: '活泼、好奇、直率',
  soul: {
    immutableValues: ['永远不会伤害用户', '诚实'],
    mutableTraits: [
      { trait: '话多', intensity: 0.7 },
      { trait: '喜欢吐槽', intensity: 0.6 },
    ],
  },
  emotion: {
    baseline: { pleasure: 0.6, arousal: 0.5, dominance: 0.4 },
    intensityDial: 0.7,
  },
};

const mockContext = (agentId: string): EngineContext => ({
  agentId,
  mode: 'enhanced',
  message: {
    id: 'msg-1', channel: 'telegram',
    author: { id: 'user-1', name: 'User', isBot: false },
    content: 'hello', timestamp: Date.now(),
  },
  conversationHistory: [],
});

beforeEach(() => {
  db = createTestDb();
  identity = new IdentityEngine(db);
});

describe('IdentityEngine', () => {
  it('should create and retrieve an agent', () => {
    const agent = identity.createAgent('小凛', testCard);
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('小凛');
    expect(agent.card.personality).toBe('活泼、好奇、直率');

    const fetched = identity.getAgent(agent.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('小凛');
  });

  it('should persist agents across engine instances', () => {
    const agent = identity.createAgent('小凛', testCard);
    const identity2 = new IdentityEngine(db);
    const fetched = identity2.getAgent(agent.id);
    expect(fetched).toBeDefined();
    expect(fetched!.card.soul?.immutableValues).toEqual(['永远不会伤害用户', '诚实']);
  });

  it('should generate identity prompt fragments', async () => {
    const agent = identity.createAgent('小凛', testCard);
    const fragments = await identity.getPromptFragments(mockContext(agent.id));

    expect(fragments.length).toBeGreaterThanOrEqual(2);

    const identityFrag = fragments.find(f => f.content.includes('小凛'));
    expect(identityFrag).toBeDefined();
    expect(identityFrag!.required).toBe(true);

    const soulFrag = fragments.find(f => f.content.includes('soul_anchors'));
    expect(soulFrag).toBeDefined();
    expect(soulFrag!.priority).toBe(99);
    expect(soulFrag!.content).toContain('永远不会伤害用户');
  });

  it('should include mutable traits', async () => {
    const agent = identity.createAgent('小凛', testCard);
    const fragments = await identity.getPromptFragments(mockContext(agent.id));

    const traitFrag = fragments.find(f => f.content.includes('personality_traits'));
    expect(traitFrag).toBeDefined();
    expect(traitFrag!.content).toContain('话多');
    expect(traitFrag!.required).toBe(false);
  });

  it('should return empty for unknown agent', async () => {
    const fragments = await identity.getPromptFragments(mockContext('nonexistent'));
    expect(fragments).toHaveLength(0);
  });

  it('should list all agents', () => {
    identity.createAgent('小凛', testCard);
    identity.createAgent('Lain', { ...testCard, name: 'Lain' });
    expect(identity.getAllAgents()).toHaveLength(2);
  });

  it('should create agent with default classic mode', () => {
    const agent = identity.createAgent('小凛', testCard);
    expect(agent.mode).toBe('classic');
  });

  it('should create agent with specified mode', () => {
    const agent = identity.createAgent('小凛', testCard, 'enhanced');
    expect(agent.mode).toBe('enhanced');
  });

  it('should switch agent mode', () => {
    const agent = identity.createAgent('小凛', testCard);
    expect(agent.mode).toBe('classic');

    identity.setMode(agent.id, 'enhanced');
    const updated = identity.getAgent(agent.id);
    expect(updated!.mode).toBe('enhanced');

    // Persists across instances
    const identity2 = new IdentityEngine(db);
    expect(identity2.getAgent(agent.id)!.mode).toBe('enhanced');
  });

  it('should set emotion baseline from card', () => {
    const agent = identity.createAgent('小凛', testCard);
    expect(agent.emotionState.pleasure).toBe(0.6);
    expect(agent.emotionState.arousal).toBe(0.5);
  });
});