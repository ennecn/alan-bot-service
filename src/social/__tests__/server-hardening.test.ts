import { describe, it, expect, afterEach } from 'vitest';
import { createSocialServer } from '../server.js';

/**
 * Tests for social layer hardening:
 * 1. API key authentication (PRD §8.5)
 * 2. Event queue overflow enforcement (PRD §8.5)
 * 3. Agent reference constraints (PRD §8.4)
 */

// --- Auth Tests ---

describe('API Key Authentication', () => {
  const apiKeys = new Map([
    ['key-alice', 'agent-alice'],
    ['key-bob', 'agent-bob'],
  ]);

  function makeServer() {
    return createSocialServer({ dbPath: ':memory:', apiKeys });
  }

  it('returns 401 when no key provided', async () => {
    const { app } = makeServer();
    const res = await app.request('/agents', { method: 'GET' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 for invalid key', async () => {
    const { app } = makeServer();
    const res = await app.request('/agents', {
      method: 'GET',
      headers: { 'x-eventbus-key': 'bad-key' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 200 for valid key', async () => {
    const { app } = makeServer();
    const res = await app.request('/agents', {
      method: 'GET',
      headers: { 'x-eventbus-key': 'key-alice' },
    });
    expect(res.status).toBe(200);
  });

  it('allows /health without key', async () => {
    const { app } = makeServer();
    const res = await app.request('/health', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('works without apiKeys (no auth enforced)', async () => {
    const { app } = createSocialServer({ dbPath: ':memory:' });
    const res = await app.request('/agents', { method: 'GET' });
    expect(res.status).toBe(200);
  });
});

// --- Overflow Tests ---

describe('Event Queue Overflow', () => {
  it('drops oldest pending event when cap (500) is reached', async () => {
    const { eventBus, registry } = createSocialServer({ dbPath: ':memory:' });

    // Register agents so constraint checks pass
    registry.register('src', 'Source');
    registry.register('tgt', 'Target');

    // Publish 500 events to fill the cap
    for (let i = 0; i < 500; i++) {
      eventBus.publish({
        source_agent: 'src',
        target_agent: 'tgt',
        type: 'emotion_shift',
        payload: { seq: i },
      });
    }

    expect(eventBus.getPendingCount('tgt')).toBe(500);

    // Publish the 501st event — should drop the oldest
    eventBus.publish({
      source_agent: 'src',
      target_agent: 'tgt',
      type: 'emotion_shift',
      payload: { seq: 500 },
    });

    // Still at cap
    expect(eventBus.getPendingCount('tgt')).toBe(500);

    // Poll and check: oldest (seq=0) should be gone, newest (seq=500) present
    const events = eventBus.poll('tgt');
    expect(events).toHaveLength(500);
    const sequences = events.map((e) => (e.payload as { seq: number }).seq);
    expect(sequences[0]).toBe(1); // seq=0 was dropped
    expect(sequences[sequences.length - 1]).toBe(500);
  });
});

// --- Agent Reference Constraint Tests ---

describe('Agent Reference Constraints', () => {
  it('rejects publish to nonexistent agent', () => {
    const { eventBus } = createSocialServer({ dbPath: ':memory:' });

    expect(() =>
      eventBus.publish({
        source_agent: 'src',
        target_agent: 'ghost',
        type: 'emotion_shift',
        payload: {},
      }),
    ).toThrow("Target agent 'ghost' not found");
  });

  it('rejects publish to offline agent', () => {
    const { eventBus, registry } = createSocialServer({ dbPath: ':memory:' });
    registry.register('src', 'Source');
    const agent = registry.register('tgt', 'Target');
    registry.deregister('tgt'); // sets status to 'retired'

    expect(() =>
      eventBus.publish({
        source_agent: 'src',
        target_agent: 'tgt',
        type: 'emotion_shift',
        payload: {},
      }),
    ).toThrow("Target agent 'tgt' is retired, must be online");
  });

  it('accepts publish to online agent', () => {
    const { eventBus, registry } = createSocialServer({ dbPath: ':memory:' });
    registry.register('src', 'Source');
    registry.register('tgt', 'Target');

    const event = eventBus.publish({
      source_agent: 'src',
      target_agent: 'tgt',
      type: 'emotion_shift',
      payload: { val: 1 },
    });

    expect(event.id).toBeDefined();
    expect(event.target_agent).toBe('tgt');
  });

  it('allows broadcast events (null target) without constraint check', () => {
    const { eventBus } = createSocialServer({ dbPath: ':memory:' });

    const event = eventBus.publish({
      source_agent: 'src',
      target_agent: null,
      type: 'life_event',
      payload: { content: 'hello' },
    });

    expect(event.target_agent).toBeNull();
  });

  it('returns 422 from HTTP endpoint when target agent is offline', async () => {
    const { app, registry } = createSocialServer({ dbPath: ':memory:' });
    registry.register('src', 'Source');
    registry.register('tgt', 'Target');
    registry.deregister('tgt');

    const res = await app.request('/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_agent: 'src',
        target_agent: 'tgt',
        type: 'emotion_shift',
        payload: {},
      }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('retired');
  });
});
