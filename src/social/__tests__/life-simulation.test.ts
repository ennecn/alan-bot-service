import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBusDB } from '../event-bus-db.js';
import { EventBus } from '../event-bus.js';
import { AgentRegistry } from '../agent-registry.js';
import { LifeSimulation } from '../life-simulation.js';

function setup() {
  const db = new EventBusDB(':memory:');
  const eventBus = new EventBus(db);
  const registry = new AgentRegistry(db);
  const lifeSim = new LifeSimulation(eventBus, registry);
  return { db, eventBus, registry, lifeSim };
}

describe('LifeSimulation', () => {
  it('Layer 0: emitSelfMemory creates non-propagated event', () => {
    const { lifeSim } = setup();
    const event = lifeSim.emitSelfMemory('agent-a', 'feeling peaceful');

    expect(event.layer).toBe(0);
    expect(event.agent_id).toBe('agent-a');
    expect(event.content).toBe('feeling peaceful');
    expect(event.propagated).toBe(false);
  });

  it('Layer 1: emitSkeleton publishes to event bus', () => {
    const { lifeSim, eventBus } = setup();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const event = lifeSim.emitSkeleton('agent-a', 'woke up');

    expect(event.layer).toBe(1);
    expect(event.content).toBe('woke up');
    expect(event.propagated).toBe(true);
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source_agent: 'agent-a',
        target_agent: null,
        type: 'life_event',
        payload: { layer: 1, content: 'woke up' },
      }),
    );
  });

  it('Layer 2: enrichNarrative updates content and layer', () => {
    const { lifeSim } = setup();
    const skeleton = lifeSim.emitSkeleton('agent-a', 'ate lunch');
    const enriched = lifeSim.enrichNarrative(
      skeleton,
      'Had a warm bowl of ramen at the corner shop, watching rain fall outside.',
    );

    expect(enriched.layer).toBe(2);
    expect(enriched.content).toContain('ramen');
    expect(enriched.agent_id).toBe('agent-a');
  });

  it('Layer 3: broadcastFact sends to all online agents except self', () => {
    const { lifeSim, eventBus, registry } = setup();
    registry.register('agent-a', 'Alice');
    registry.register('agent-b', 'Bob');
    registry.register('agent-c', 'Carol');

    const publishSpy = vi.spyOn(eventBus, 'publish');

    lifeSim.broadcastFact('agent-a', 'The cafe closed today');

    // Should publish to agent-b and agent-c, but not agent-a
    expect(publishSpy).toHaveBeenCalledTimes(2);
    const targets = publishSpy.mock.calls.map(
      (call) => (call[0] as { target_agent: string }).target_agent,
    );
    expect(targets).toContain('agent-b');
    expect(targets).toContain('agent-c');
    expect(targets).not.toContain('agent-a');
  });

  it('broadcastFact skips offline agents', () => {
    const { lifeSim, eventBus, registry, db } = setup();
    registry.register('agent-a', 'Alice');
    registry.register('agent-b', 'Bob');
    db.updateAgent('agent-b', { status: 'offline' });

    const publishSpy = vi.spyOn(eventBus, 'publish');
    lifeSim.broadcastFact('agent-a', 'A fact');

    expect(publishSpy).toHaveBeenCalledTimes(0);
  });

  it('economy mode: simulateEvent skips Layer 2 narrative expansion', async () => {
    const db = new EventBusDB(':memory:');
    const eventBus = new EventBus(db);
    const registry = new AgentRegistry(db);
    const economySim = new LifeSimulation(eventBus, registry, { economyMode: true });

    registry.register('agent-a', 'Alice');
    registry.register('agent-b', 'Bob');

    const enrichFn = vi.fn(async () => 'LLM-enriched narrative');

    const result = await economySim.simulateEvent('agent-a', 'ate lunch', enrichFn);

    // enrichFn should NOT have been called (Layer 2 skipped)
    expect(enrichFn).not.toHaveBeenCalled();
    // Result should keep the skeleton content, not enriched
    expect(result.content).toBe('ate lunch');
    // Layer stays at 1 (skeleton) since Layer 2 was skipped
    expect(result.layer).toBe(1);
  });

  it('non-economy mode: simulateEvent calls Layer 2 enrichment', async () => {
    const db = new EventBusDB(':memory:');
    const eventBus = new EventBus(db);
    const registry = new AgentRegistry(db);
    const normalSim = new LifeSimulation(eventBus, registry, { economyMode: false });

    registry.register('agent-a', 'Alice');
    registry.register('agent-b', 'Bob');

    const enrichFn = vi.fn(async () => 'Had warm ramen at the corner shop');

    const result = await normalSim.simulateEvent('agent-a', 'ate lunch', enrichFn);

    // enrichFn SHOULD have been called (Layer 2 active)
    expect(enrichFn).toHaveBeenCalledOnce();
    expect(result.content).toBe('Had warm ramen at the corner shop');
    expect(result.layer).toBe(2);
  });

  it('generateDailySchedule creates skeleton events for a day', () => {
    const { lifeSim } = setup();
    const schedule = lifeSim.generateDailySchedule('agent-a');

    expect(schedule.length).toBeGreaterThanOrEqual(5);
    expect(schedule.every((e) => e.layer === 1)).toBe(true);
    expect(schedule.every((e) => e.agent_id === 'agent-a')).toBe(true);
    expect(schedule.every((e) => e.propagated === false)).toBe(true);

    const activities = schedule.map((e) => e.content);
    expect(activities).toContain('woke up');
    expect(activities).toContain('went to sleep');
  });
});
