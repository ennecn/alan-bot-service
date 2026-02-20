import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers.js';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { GrowthEngine } from '../src/engines/growth/index.js';
import { AuditLog } from '../src/security/audit.js';
import type { EngineContext, MetroidMessage, MetroidCard } from '../src/types.js';
import type Database from 'better-sqlite3';

const testConfig = {
  dataDir: ':memory:', dbPath: ':memory:',
  memory: { importanceThreshold: 0.4, fadeThreshold: 0.3, maxRetrievalResults: 5, defaultTimeWindowHours: 72 },
  llm: { apiKey: 'test', mainModel: 'test', lightModel: 'test', maxContextTokens: 200_000 },
  compiler: { responseReserveRatio: 0.3 },
  emotion: { minChangeInterval: 30_000, maxChangePerUpdate: 0.3, recoveryRate: 0.05 },
  growth: { evaluationInterval: 3, minConfidence: 0.5, maxActiveChanges: 20 },
};

function makeMsg(content: string): MetroidMessage {
  return { id: `msg-${Date.now()}`, content, author: { id: 'u1', name: 'User', isBot: false }, timestamp: new Date() } as any;
}

function ctx(agentId: string, mode: 'classic' | 'enhanced', msg: string): EngineContext {
  return { agentId, mode, message: makeMsg(msg), conversationHistory: [] };
}

const growthCard: MetroidCard = {
  name: 'GrowBot', description: 'A growing bot', personality: 'adaptive',
  growth: { enabled: true, maxDrift: 0.3, logChanges: true },
  soul: { immutableValues: ['永远保持礼貌'], mutableTraits: [] },
};

const noGrowthCard: MetroidCard = {
  name: 'StaticBot', description: 'A static bot', personality: 'fixed',
  growth: { enabled: false, maxDrift: 0, logChanges: false },
  soul: { immutableValues: [], mutableTraits: [] },
};

describe('GrowthEngine', () => {
  let db: Database.Database;
  let identity: IdentityEngine;
  let audit: AuditLog;
  let engine: GrowthEngine;
  let agentId: string;

  beforeEach(() => {
    db = createTestDb();
    audit = new AuditLog(db);
    identity = new IdentityEngine(db);
    const agent = identity.createAgent('GrowBot', growthCard, 'enhanced');
    agentId = agent.id;
    engine = new GrowthEngine(db, identity, audit, testConfig);
  });

  // === getPromptFragments ===

  describe('getPromptFragments', () => {
    it('should return empty in classic mode', async () => {
      const fragments = await engine.getPromptFragments(ctx(agentId, 'classic', 'hello'));
      expect(fragments).toHaveLength(0);
    });

    it('should return empty when no active changes', async () => {
      const fragments = await engine.getPromptFragments(ctx(agentId, 'enhanced', 'hello'));
      expect(fragments).toHaveLength(0);
    });

    it('should format active changes as behavioral_adaptations', async () => {
      // Insert a change directly
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run('test-change-1', agentId, 'test observation', 'test adaptation', 0.8);

      const fragments = await engine.getPromptFragments(ctx(agentId, 'enhanced', 'hello'));
      expect(fragments).toHaveLength(1);
      expect(fragments[0].content).toContain('<behavioral_adaptations>');
      expect(fragments[0].content).toContain('test adaptation');
      expect(fragments[0].content).toContain('80%');
      expect(fragments[0].source).toBe('growth');
      expect(fragments[0].priority).toBe(30);
    });

    it('should only include changes above minConfidence', async () => {
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run('high-conf', agentId, 'obs', 'high confidence change', 0.8);
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run('low-conf', agentId, 'obs', 'low confidence change', 0.3);

      const fragments = await engine.getPromptFragments(ctx(agentId, 'enhanced', 'hello'));
      expect(fragments[0].content).toContain('high confidence change');
      expect(fragments[0].content).not.toContain('low confidence change');
    });
  });

  // === onResponse evaluation trigger ===

  describe('onResponse', () => {
    it('should not evaluate before reaching interval', async () => {
      // evaluationInterval = 3, send 2 messages
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'no, i meant something else'));
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'not that, wrong'));
      const changes = engine.getActiveChanges(agentId);
      expect(changes).toHaveLength(0);
    });

    it('should evaluate at interval threshold', async () => {
      // Send 3 correction messages to trigger evaluation + pattern
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'no, i meant something else'));
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'not that, wrong answer'));
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'actually, i said the other thing'));
      const changes = engine.getActiveChanges(agentId);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0].adaptation).toContain('澄清');
    });

    it('should skip in classic mode', async () => {
      await engine.onResponse('ok', ctx(agentId, 'classic', 'no, i meant something'));
      await engine.onResponse('ok', ctx(agentId, 'classic', 'not that, wrong'));
      await engine.onResponse('ok', ctx(agentId, 'classic', 'actually, i said'));
      const changes = engine.getActiveChanges(agentId);
      expect(changes).toHaveLength(0);
    });

    it('should not evaluate when growth is disabled', async () => {
      const staticAgent = identity.createAgent('Static', noGrowthCard, 'enhanced');
      await engine.onResponse('ok', ctx(staticAgent.id, 'enhanced', 'no, i meant'));
      await engine.onResponse('ok', ctx(staticAgent.id, 'enhanced', 'not that'));
      await engine.onResponse('ok', ctx(staticAgent.id, 'enhanced', 'wrong'));
      const changes = engine.getActiveChanges(staticAgent.id);
      expect(changes).toHaveLength(0);
    });
  });

  // === detectPatterns ===

  describe('detectPatterns', () => {
    it('should detect correction pattern', () => {
      const messages = [
        'no, i meant the other one',
        'hello there',
        'not that, wrong answer',
        'actually, i said something different',
      ];
      const patterns = engine.detectPatterns(messages);
      const correction = patterns.find(p => p.adaptation.includes('澄清'));
      expect(correction).toBeDefined();
      expect(correction!.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should detect short reply pattern', () => {
      const messages = ['ok', 'yes', 'no', 'fine', 'sure', 'hmm', 'yeah'];
      const patterns = engine.detectPatterns(messages);
      const shortReply = patterns.find(p => p.adaptation.includes('简洁'));
      expect(shortReply).toBeDefined();
    });

    it('should detect detail request pattern', () => {
      const messages = [
        'tell me more about that',
        'can you elaborate on this?',
        'explain more please',
        'what do you mean exactly?',
      ];
      const patterns = engine.detectPatterns(messages);
      const detail = patterns.find(p => p.adaptation.includes('详细'));
      expect(detail).toBeDefined();
    });

    it('should return empty for insufficient data', () => {
      const patterns = engine.detectPatterns(['hi', 'hello']);
      expect(patterns).toHaveLength(0);
    });
  });

  // === Change management ===

  describe('change management', () => {
    it('should list active changes', () => {
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run('c1', agentId, 'obs1', 'adapt1', 0.7);
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 0)'
      ).run('c2', agentId, 'obs2', 'adapt2', 0.6);

      const active = engine.getActiveChanges(agentId);
      expect(active).toHaveLength(1);
      expect(active[0].adaptation).toBe('adapt1');
    });

    it('should revert a change', () => {
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run('c3', agentId, 'obs', 'adapt', 0.7);

      engine.revertChange('c3');
      const active = engine.getActiveChanges(agentId);
      expect(active).toHaveLength(0);

      const all = engine.getAllChanges(agentId);
      expect(all[0].active).toBe(false);
      expect(all[0].revertedAt).toBeDefined();
    });

    it('should audit growth changes', async () => {
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'no, i meant'));
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'not that'));
      await engine.onResponse('ok', ctx(agentId, 'enhanced', 'wrong'));

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE action = 'growth.create'"
      ).all() as any[];
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  // === Drift bounds ===

  describe('drift bounds', () => {
    it('should respect maxActiveChanges limit', async () => {
      const tinyConfig = { ...testConfig, growth: { ...testConfig.growth, maxActiveChanges: 1 } };
      const tinyEngine = new GrowthEngine(db, identity, audit, tinyConfig);

      // Insert one change to fill the cap
      db.prepare(
        'INSERT INTO behavioral_changes (id, agent_id, observation, adaptation, confidence, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run('existing', agentId, 'obs', 'existing adaptation', 0.8);

      // Try to trigger more
      await tinyEngine.onResponse('ok', ctx(agentId, 'enhanced', 'no, i meant'));
      await tinyEngine.onResponse('ok', ctx(agentId, 'enhanced', 'not that'));
      await tinyEngine.onResponse('ok', ctx(agentId, 'enhanced', 'wrong'));

      const changes = tinyEngine.getActiveChanges(agentId);
      expect(changes).toHaveLength(1); // Still just the one
    });
  });
});
