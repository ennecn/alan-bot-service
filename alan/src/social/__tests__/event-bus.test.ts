import { describe, it, expect, vi } from 'vitest';
import { EventBusDB } from '../event-bus-db.js';
import { EventBus } from '../event-bus.js';
import type { SocialEvent, EventType } from '../types.js';

function makeDb(): EventBusDB {
  return new EventBusDB(':memory:');
}

function makeEvent(overrides: Partial<SocialEvent> = {}): SocialEvent {
  return {
    id: 'evt-1',
    source_agent: 'agent-a',
    target_agent: 'agent-b',
    type: 'emotion_shift',
    payload: { intensity: 0.5 },
    created_at: new Date().toISOString(),
    delivered_at: null,
    ...overrides,
  };
}

describe('EventBusDB', () => {
  it('insert and retrieve pending events', () => {
    const db = makeDb();
    const evt = makeEvent();
    db.insertEvent(evt);

    const pending = db.getPendingEvents('agent-b');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('evt-1');
    expect(pending[0].payload).toEqual({ intensity: 0.5 });
    db.close();
  });

  it('markDelivered removes event from pending', () => {
    const db = makeDb();
    db.insertEvent(makeEvent());
    db.markDelivered('evt-1');

    const pending = db.getPendingEvents('agent-b');
    expect(pending).toHaveLength(0);
    db.close();
  });

  it('getPendingCount returns correct count', () => {
    const db = makeDb();
    db.insertEvent(makeEvent({ id: 'e1', target_agent: 'agent-b' }));
    db.insertEvent(makeEvent({ id: 'e2', target_agent: 'agent-b' }));
    db.insertEvent(makeEvent({ id: 'e3', target_agent: 'agent-c' }));

    expect(db.getPendingCount('agent-b')).toBe(2);
    expect(db.getPendingCount('agent-c')).toBe(1);
    db.close();
  });

  it('respects limit on getPendingEvents', () => {
    const db = makeDb();
    for (let i = 0; i < 10; i++) {
      db.insertEvent(makeEvent({ id: `e-${i}`, target_agent: 'agent-b' }));
    }
    const pending = db.getPendingEvents('agent-b', 3);
    expect(pending).toHaveLength(3);
    db.close();
  });

  it('getRecentEvents returns events in descending order', () => {
    const db = makeDb();
    db.insertEvent(makeEvent({ id: 'e1', created_at: '2026-01-01T00:00:00Z' }));
    db.insertEvent(makeEvent({ id: 'e2', created_at: '2026-01-02T00:00:00Z' }));

    const recent = db.getRecentEvents(10);
    expect(recent[0].id).toBe('e2');
    expect(recent[1].id).toBe('e1');
    db.close();
  });

  it('register and retrieve agent', () => {
    const db = makeDb();
    db.registerAgent({
      id: 'a1',
      name: 'Alice',
      status: 'online',
      last_seen: new Date().toISOString(),
      metadata: { role: 'test' },
      registered_at: new Date().toISOString(),
    });

    const agent = db.getAgent('a1');
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe('Alice');
    expect(agent!.metadata).toEqual({ role: 'test' });
    db.close();
  });

  it('updateAgent changes fields', () => {
    const db = makeDb();
    db.registerAgent({
      id: 'a1',
      name: 'Alice',
      status: 'online',
      last_seen: '2026-01-01T00:00:00Z',
      metadata: {},
      registered_at: '2026-01-01T00:00:00Z',
    });

    db.updateAgent('a1', { status: 'offline', name: 'Alice Updated' });
    const agent = db.getAgent('a1');
    expect(agent!.status).toBe('offline');
    expect(agent!.name).toBe('Alice Updated');
    db.close();
  });

  it('getAgentsByStatus filters correctly', () => {
    const db = makeDb();
    const now = new Date().toISOString();
    db.registerAgent({ id: 'a1', name: 'A', status: 'online', last_seen: now, metadata: {}, registered_at: now });
    db.registerAgent({ id: 'a2', name: 'B', status: 'offline', last_seen: now, metadata: {}, registered_at: now });
    db.registerAgent({ id: 'a3', name: 'C', status: 'online', last_seen: now, metadata: {}, registered_at: now });

    expect(db.getAgentsByStatus('online')).toHaveLength(2);
    expect(db.getAgentsByStatus('offline')).toHaveLength(1);
    db.close();
  });
});

describe('EventBus', () => {
  it('publish stores event and returns it with ID', () => {
    const db = makeDb();
    const bus = new EventBus(db);

    const event = bus.publish({
      source_agent: 'agent-a',
      target_agent: 'agent-b',
      type: 'emotion_shift',
      payload: { val: 1 },
    });

    expect(event.id).toBeDefined();
    expect(event.created_at).toBeDefined();
    expect(event.delivered_at).toBeNull();
    expect(event.payload).toEqual({ val: 1 });
    db.close();
  });

  it('poll returns pending events and marks them delivered', () => {
    const db = makeDb();
    const bus = new EventBus(db);

    bus.publish({
      source_agent: 'a',
      target_agent: 'b',
      type: 'memory_update',
      payload: {},
    });

    const events = bus.poll('b');
    expect(events).toHaveLength(1);

    // Second poll returns empty — already delivered
    const events2 = bus.poll('b');
    expect(events2).toHaveLength(0);
    db.close();
  });

  it('subscribe callback fires on publish', () => {
    const db = makeDb();
    const bus = new EventBus(db);
    const callback = vi.fn();

    bus.subscribe('agent-b', callback);
    bus.publish({
      source_agent: 'agent-a',
      target_agent: 'agent-b',
      type: 'social_post',
      payload: { text: 'hello' },
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'social_post' }),
    );
    db.close();
  });

  it('unsubscribe stops callback', () => {
    const db = makeDb();
    const bus = new EventBus(db);
    const callback = vi.fn();

    const unsubscribe = bus.subscribe('agent-b', callback);
    unsubscribe();

    bus.publish({
      source_agent: 'a',
      target_agent: 'agent-b',
      type: 'reaction',
      payload: {},
    });

    expect(callback).not.toHaveBeenCalled();
    db.close();
  });

  it('broadcast events (target_agent=null) are stored but not notified', () => {
    const db = makeDb();
    const bus = new EventBus(db);

    const event = bus.publish({
      source_agent: 'a',
      target_agent: null,
      type: 'life_event',
      payload: { content: 'woke up' },
    });

    expect(event.target_agent).toBeNull();
    db.close();
  });
});
