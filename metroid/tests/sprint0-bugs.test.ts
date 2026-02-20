/**
 * Sprint 0 Bug Fix Tests
 * - Forgetter multi-agent support (BUG-2)
 * - Impulse state persistence (BUG-3)
 * - Memory privacy enforcement (BUG-5)
 * - Growth → Identity trait sync (BUG-4)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, createTestAgent } from './helpers.js';
import { MemoryStore } from '../src/engines/memory/store.js';
import { MemoryRetriever } from '../src/engines/memory/retriever.js';
import { MemoryForgetter } from '../src/engines/memory/forgetter.js';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { GrowthEngine } from '../src/engines/growth/index.js';
import { AuditLog } from '../src/security/audit.js';
import { defaultConfig } from '../src/config.js';
import type { MetroidCard, MetroidMessage, EngineContext } from '../src/types.js';

// === BUG-2: Forgetter multi-agent ===

describe('MemoryForgetter multi-agent (BUG-2)', () => {
  let db: Database.Database;
  let store: MemoryStore;
  let audit: AuditLog;
  let forgetter: MemoryForgetter;
  let agent1: string;
  let agent2: string;

  beforeEach(() => {
    db = createTestDb();
    store = new MemoryStore(db);
    audit = new AuditLog(db);
    forgetter = new MemoryForgetter(store, audit, defaultConfig);
    agent1 = createTestAgent(db, 'agent-1');
    agent2 = createTestAgent(db, 'agent-2');
  });

  it('should start separate timers for multiple agents', () => {
    forgetter.start(agent1);
    forgetter.start(agent2);
    // Both should be running — stopping one shouldn't affect the other
    forgetter.stop(agent1);
    // agent2 should still be running (no crash, no error)
    forgetter.stop(agent2);
  });

  it('should decay memories independently per agent', async () => {
    // Agent 1: low importance memory
    store.create({
      agentId: agent1, type: 'semantic', content: 'agent1 trivial',
      importance: 0.25, confidence: 0.5, privacy: 'private', keywords: ['trivial'],
    });
    // Agent 2: high importance memory
    store.create({
      agentId: agent2, type: 'semantic', content: 'agent2 important',
      importance: 0.9, confidence: 0.9, privacy: 'private', keywords: ['important'],
    });

    const faded1 = await forgetter.decayCycle(agent1);
    const faded2 = await forgetter.decayCycle(agent2);

    expect(faded1).toBe(1); // agent1's low-importance memory faded
    expect(faded2).toBe(0); // agent2's high-importance memory preserved
  });

  it('should not block second agent when first is already started', async () => {
    forgetter.start(agent1);
    forgetter.start(agent2); // should NOT be blocked by agent1's timer
    // Verify by running decay cycles for both
    const r1 = await forgetter.decayCycle(agent1);
    const r2 = await forgetter.decayCycle(agent2);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    forgetter.stop();
  });
});

// === BUG-3: Impulse state persistence ===

describe('Impulse state persistence (BUG-3)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('should have impulse_states table in schema', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='impulse_states'"
    ).all() as any[];
    expect(tables).toHaveLength(1);
  });

  it('should persist and load impulse state via UPSERT', () => {
    const agentId = createTestAgent(db);

    // Insert
    db.prepare(`
      INSERT INTO impulse_states (agent_id, impulse_value, last_decay_time, last_fire_time, active_events, suppression_count)
      VALUES (?, ?, datetime('now'), datetime('now'), ?, ?)
    `).run(agentId, 0.75, JSON.stringify([{ name: 'farewell', intensity: 0.8, createdAt: Date.now(), decayRate: 0.5 }]), 3);

    // Read back
    const row = db.prepare('SELECT * FROM impulse_states WHERE agent_id = ?').get(agentId) as any;
    expect(row).toBeDefined();
    expect(row.impulse_value).toBeCloseTo(0.75);
    expect(row.suppression_count).toBe(3);
    const events = JSON.parse(row.active_events);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('farewell');

    // UPSERT (update)
    db.prepare(`
      INSERT INTO impulse_states (agent_id, impulse_value, last_decay_time, active_events, suppression_count, updated_at)
      VALUES (?, ?, datetime('now'), ?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        impulse_value = excluded.impulse_value,
        active_events = excluded.active_events,
        suppression_count = excluded.suppression_count,
        updated_at = datetime('now')
    `).run(agentId, 0.3, '[]', 0);

    const updated = db.prepare('SELECT * FROM impulse_states WHERE agent_id = ?').get(agentId) as any;
    expect(updated.impulse_value).toBeCloseTo(0.3);
    expect(updated.suppression_count).toBe(0);
  });
});

// === BUG-5: Memory privacy enforcement ===

describe('Memory privacy enforcement (BUG-5)', () => {
  let db: Database.Database;
  let store: MemoryStore;
  let agentId: string;

  beforeEach(() => {
    db = createTestDb();
    store = new MemoryStore(db);
    agentId = createTestAgent(db);
  });

  it('should exclude sensitive memories with default privacy filter', async () => {
    const retriever = new MemoryRetriever(store);

    store.create({
      agentId, type: 'semantic', content: 'public fact about cats',
      importance: 0.8, confidence: 0.9, privacy: 'public', keywords: ['cats'],
    });
    store.create({
      agentId, type: 'semantic', content: 'private memory about cats',
      importance: 0.8, confidence: 0.9, privacy: 'private', keywords: ['cats'],
    });
    store.create({
      agentId, type: 'semantic', content: 'sensitive secret about cats',
      importance: 0.9, confidence: 1.0, privacy: 'sensitive', keywords: ['cats'],
    });

    // Default filter: public + private only
    const results = await retriever.retrieve({
      agentId, text: 'cats', privacyFilter: ['public', 'private'],
    });
    expect(results.every(r => r.memory.privacy !== 'sensitive')).toBe(true);
    expect(results.some(r => r.memory.privacy === 'public')).toBe(true);
  });

  it('should include sensitive when explicitly allowed', async () => {
    const retriever = new MemoryRetriever(store);

    store.create({
      agentId, type: 'semantic', content: 'sensitive secret about dogs',
      importance: 0.9, confidence: 1.0, privacy: 'sensitive', keywords: ['dogs'],
    });

    const results = await retriever.retrieve({
      agentId, text: 'dogs', privacyFilter: ['public', 'private', 'sensitive'],
    });
    expect(results.some(r => r.memory.privacy === 'sensitive')).toBe(true);
  });
});

// === BUG-4: Growth → Identity trait sync ===

describe('Growth → Identity trait sync (BUG-4)', () => {
  let db: Database.Database;
  let identity: IdentityEngine;

  function makeCard(): MetroidCard {
    return {
      name: 'TraitBot', description: 'A bot with traits', personality: 'adaptive',
      growth: { enabled: true, maxDrift: 0.3, logChanges: true },
      soul: {
        immutableValues: ['永远保持礼貌'],
        mutableTraits: [{ trait: '简洁', intensity: 0.5 }],
      },
    };
  }

  beforeEach(() => {
    db = createTestDb();
    identity = new IdentityEngine(db);
  });

  it('should update existing trait intensity', () => {
    const agent = identity.createAgent('TraitBot', makeCard(), 'enhanced');
    identity.updateTrait(agent.id, '简洁', 0.1);

    const updated = identity.getAgent(agent.id);
    const trait = updated!.card.soul!.mutableTraits!.find(t => t.trait === '简洁');
    expect(trait!.intensity).toBeCloseTo(0.6);
  });

  it('should create new trait if not exists', () => {
    const agent = identity.createAgent('TraitBot', makeCard(), 'enhanced');
    identity.updateTrait(agent.id, '好奇心引导', 0.1);

    const updated = identity.getAgent(agent.id);
    const trait = updated!.card.soul!.mutableTraits!.find(t => t.trait === '好奇心引导');
    expect(trait).toBeDefined();
    expect(trait!.intensity).toBeCloseTo(0.6); // 0.5 + 0.1
  });

  it('should clamp trait intensity to [0, 1]', () => {
    const agent = identity.createAgent('TraitBot', makeCard(), 'enhanced');
    identity.updateTrait(agent.id, '简洁', 0.8); // 0.5 + 0.8 = 1.3 → clamped to 1.0

    const updated = identity.getAgent(agent.id);
    const trait = updated!.card.soul!.mutableTraits!.find(t => t.trait === '简洁');
    expect(trait!.intensity).toBe(1.0);
  });

  it('should persist trait changes to DB', () => {
    const agent = identity.createAgent('TraitBot', makeCard(), 'enhanced');
    identity.updateTrait(agent.id, '简洁', 0.2);

    // Read directly from DB
    const row = db.prepare('SELECT card_json FROM agents WHERE id = ?').get(agent.id) as any;
    const card = JSON.parse(row.card_json);
    const trait = card.soul.mutableTraits.find((t: any) => t.trait === '简洁');
    expect(trait.intensity).toBeCloseTo(0.7);
  });
});
