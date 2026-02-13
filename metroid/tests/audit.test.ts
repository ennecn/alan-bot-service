import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { AuditLog } from '../src/security/audit.js';
import { createTestDb } from './helpers.js';

let db: Database.Database;
let audit: AuditLog;

beforeEach(() => {
  db = createTestDb();
  audit = new AuditLog(db);
});

describe('AuditLog', () => {
  it('should log and retrieve entries', async () => {
    await audit.log({
      timestamp: new Date(),
      actor: 'agent:alin',
      action: 'memory.create',
      target: 'mem-123',
      details: { content: 'test memory' },
    });

    const entries = audit.getRecent(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe('agent:alin');
    expect(entries[0].action).toBe('memory.create');
    expect(entries[0].details).toEqual({ content: 'test memory' });
  });

  it('should query by actor', async () => {
    await audit.log({
      timestamp: new Date(), actor: 'agent:alin',
      action: 'memory.create', target: 'mem-1',
    });
    await audit.log({
      timestamp: new Date(), actor: 'system',
      action: 'memory.fade', target: 'mem-2',
    });
    await audit.log({
      timestamp: new Date(), actor: 'agent:alin',
      action: 'emotion.update', target: 'agent:alin',
    });

    const alinEntries = audit.getByActor('agent:alin');
    expect(alinEntries).toHaveLength(2);

    const systemEntries = audit.getByActor('system');
    expect(systemEntries).toHaveLength(1);
  });

  it('should be append-only (no update/delete methods)', () => {
    // AuditLog class only exposes log() and get methods
    const methods = Object.getOwnPropertyNames(AuditLog.prototype);
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
  });
});
