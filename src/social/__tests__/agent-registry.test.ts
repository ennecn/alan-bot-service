import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBusDB } from '../event-bus-db.js';
import { AgentRegistry } from '../agent-registry.js';

function makeDb(): EventBusDB {
  return new EventBusDB(':memory:');
}

describe('AgentRegistry', () => {
  let db: EventBusDB;
  let registry: AgentRegistry;

  beforeEach(() => {
    db = makeDb();
    registry = new AgentRegistry(db);
  });

  it('register creates agent with online status', () => {
    const agent = registry.register('a1', 'Alice');
    expect(agent.id).toBe('a1');
    expect(agent.name).toBe('Alice');
    expect(agent.status).toBe('online');
    expect(agent.registered_at).toBeDefined();
    db.close();
  });

  it('register with metadata', () => {
    const agent = registry.register('a1', 'Alice', { role: 'test' });
    expect(agent.metadata).toEqual({ role: 'test' });
    db.close();
  });

  it('getAgent returns null for unknown ID', () => {
    expect(registry.getAgent('unknown')).toBeNull();
    db.close();
  });

  it('heartbeat updates last_seen', () => {
    registry.register('a1', 'Alice');
    const before = registry.getAgent('a1')!.last_seen;

    // Wait a tiny bit so timestamp differs
    const later = new Date(Date.now() + 1000).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(later));

    registry.heartbeat('a1');
    const after = registry.getAgent('a1')!.last_seen;
    expect(after).not.toBe(before);

    vi.useRealTimers();
    db.close();
  });

  it('heartbeat transitions offline to online', () => {
    registry.register('a1', 'Alice');
    db.updateAgent('a1', { status: 'offline' });
    expect(registry.getAgent('a1')!.status).toBe('offline');

    registry.heartbeat('a1');
    expect(registry.getAgent('a1')!.status).toBe('online');
    db.close();
  });

  it('heartbeat on unknown agent does nothing', () => {
    // Should not throw
    registry.heartbeat('unknown');
    db.close();
  });

  it('deregister sets status to retired', () => {
    registry.register('a1', 'Alice');
    registry.deregister('a1');
    expect(registry.getAgent('a1')!.status).toBe('retired');
    db.close();
  });

  it('getOnlineAgents returns only online agents', () => {
    registry.register('a1', 'Alice');
    registry.register('a2', 'Bob');
    registry.deregister('a2');

    const online = registry.getOnlineAgents();
    expect(online).toHaveLength(1);
    expect(online[0].id).toBe('a1');
    db.close();
  });

  it('getAllAgents returns all agents', () => {
    registry.register('a1', 'Alice');
    registry.register('a2', 'Bob');
    expect(registry.getAllAgents()).toHaveLength(2);
    db.close();
  });

  it('checkDormant marks agents offline >72h as dormant', () => {
    vi.useFakeTimers();
    const past = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(past);

    registry.register('a1', 'Alice');
    db.updateAgent('a1', { status: 'offline', last_seen: past.toISOString() });

    // Jump 73 hours forward
    vi.setSystemTime(new Date(past.getTime() + 73 * 60 * 60 * 1000));

    const dormant = registry.checkDormant();
    expect(dormant).toEqual(['a1']);
    expect(registry.getAgent('a1')!.status).toBe('dormant');

    vi.useRealTimers();
    db.close();
  });

  it('checkDormant ignores recently offline agents', () => {
    registry.register('a1', 'Alice');
    db.updateAgent('a1', { status: 'offline' });

    const dormant = registry.checkDormant();
    expect(dormant).toEqual([]);
    db.close();
  });
});
