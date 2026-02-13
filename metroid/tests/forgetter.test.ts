import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { MemoryStore } from '../src/engines/memory/store.js';
import { MemoryForgetter } from '../src/engines/memory/forgetter.js';
import { AuditLog } from '../src/security/audit.js';
import { defaultConfig } from '../src/config.js';
import { createTestDb, createTestAgent } from './helpers.js';

let db: Database.Database;
let store: MemoryStore;
let audit: AuditLog;
let forgetter: MemoryForgetter;
let agentId: string;

beforeEach(() => {
  db = createTestDb();
  store = new MemoryStore(db);
  audit = new AuditLog(db);
  forgetter = new MemoryForgetter(store, audit, defaultConfig);
  agentId = createTestAgent(db);
});

describe('MemoryForgetter', () => {
  it('should fade low-importance memories', async () => {
    // Create a memory with low importance
    const mem = store.create({
      agentId, type: 'semantic', content: 'trivial info',
      importance: 0.25, confidence: 0.5, privacy: 'private', keywords: ['trivial'],
    });

    const fadedCount = await forgetter.decayCycle(agentId);

    // The memory should have been faded (importance 0.25 < threshold 0.3)
    const fetched = store.getById(mem.id);
    expect(fetched!.fadedAt).toBeDefined();
    expect(fadedCount).toBe(1);

    // Should be logged in audit
    const logs = audit.getRecent(10);
    const fadeLog = logs.find(l => l.action === 'memory.fade');
    expect(fadeLog).toBeDefined();
    expect(fadeLog!.target).toBe(mem.id);
  });

  it('should not fade high-importance memories', async () => {
    store.create({
      agentId, type: 'semantic', content: 'important info',
      importance: 0.9, confidence: 0.9, privacy: 'private', keywords: ['important'],
    });

    const fadedCount = await forgetter.decayCycle(agentId);
    expect(fadedCount).toBe(0);
  });

  it('should decay importance over time for borderline memories', async () => {
    // Create memory with importance just above fade threshold
    const mem = store.create({
      agentId, type: 'semantic', content: 'borderline info',
      importance: 0.45, confidence: 0.7, privacy: 'private', keywords: ['borderline'],
    });

    // Run decay — since the memory was just created (age ~0),
    // decay should be minimal
    await forgetter.decayCycle(agentId);

    const fetched = store.getById(mem.id);
    // Should still be active (not faded) since it's new
    expect(fetched!.fadedAt).toBeUndefined();
  });
});
