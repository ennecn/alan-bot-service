/**
 * LifeSimulation — 3-layer event generation for agent life simulation.
 */

import { randomUUID } from 'node:crypto';
import type { EventBus } from './event-bus.js';
import type { AgentRegistry } from './agent-registry.js';
import type { LifeEvent, LifeEventLayer } from './types.js';

const DAILY_SKELETON: Array<{ hour: number; activity: string }> = [
  { hour: 7, activity: 'woke up' },
  { hour: 8, activity: 'ate breakfast' },
  { hour: 9, activity: 'started working' },
  { hour: 12, activity: 'ate lunch' },
  { hour: 14, activity: 'reading a book' },
  { hour: 16, activity: 'went for a walk' },
  { hour: 18, activity: 'ate dinner' },
  { hour: 20, activity: 'watching a movie' },
  { hour: 22, activity: 'went to sleep' },
];

export class LifeSimulation {
  constructor(
    private eventBus: EventBus,
    private registry: AgentRegistry,
  ) {}

  /** Layer 0: Internal state change, no propagation */
  emitSelfMemory(agentId: string, content: string): LifeEvent {
    return {
      layer: 0,
      agent_id: agentId,
      content,
      timestamp: new Date().toISOString(),
      propagated: false,
    };
  }

  /** Layer 1: Cron-triggered skeleton activity, publishes to event bus */
  emitSkeleton(agentId: string, activity: string): LifeEvent {
    const event: LifeEvent = {
      layer: 1,
      agent_id: agentId,
      content: activity,
      timestamp: new Date().toISOString(),
      propagated: true,
    };

    this.eventBus.publish({
      source_agent: agentId,
      target_agent: null,
      type: 'life_event',
      payload: { layer: 1, content: activity },
    });

    return event;
  }

  /** Layer 2: Takes skeleton + LLM-enriched narrative, updates the event */
  enrichNarrative(skeleton: LifeEvent, enrichedContent: string): LifeEvent {
    return {
      ...skeleton,
      layer: 2,
      content: enrichedContent,
    };
  }

  /** Layer 3: Broadcast notable facts to all online agents (1 level only) */
  broadcastFact(agentId: string, fact: string): void {
    const onlineAgents = this.registry.getOnlineAgents();
    for (const agent of onlineAgents) {
      if (agent.id === agentId) continue;
      this.eventBus.publish({
        source_agent: agentId,
        target_agent: agent.id,
        type: 'life_event',
        payload: { layer: 3, content: fact },
      });
    }
  }

  /** Generate a list of skeleton events for a full day */
  generateDailySchedule(agentId: string): LifeEvent[] {
    const today = new Date();
    return DAILY_SKELETON.map(({ hour, activity }) => {
      const ts = new Date(today);
      ts.setHours(hour, 0, 0, 0);
      return {
        layer: 1 as LifeEventLayer,
        agent_id: agentId,
        content: activity,
        timestamp: ts.toISOString(),
        propagated: false,
      };
    });
  }
}
