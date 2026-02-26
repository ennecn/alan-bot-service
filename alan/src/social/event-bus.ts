/**
 * EventBus — Core event routing service.
 */

import { randomUUID } from 'node:crypto';
import type { EventBusDB } from './event-bus-db.js';
import type { AgentRegistry } from './agent-registry.js';
import type { SocialEvent, EventType } from './types.js';

const PENDING_CAP = 500;

export class EventBus {
  private subscribers = new Map<string, Set<(event: SocialEvent) => void>>();
  private registry: AgentRegistry | null;

  constructor(private db: EventBusDB, registry?: AgentRegistry) {
    this.registry = registry ?? null;
  }

  publish(
    event: Omit<SocialEvent, 'id' | 'created_at' | 'delivered_at'>,
  ): SocialEvent {
    // Validate target agent exists and is online
    if (event.target_agent && this.registry) {
      const target = this.registry.getAgent(event.target_agent);
      if (!target) {
        throw new Error(`Target agent '${event.target_agent}' not found`);
      }
      if (target.status !== 'online') {
        throw new Error(
          `Target agent '${event.target_agent}' is ${target.status}, must be online`,
        );
      }
    }

    const full: SocialEvent = {
      ...event,
      id: randomUUID(),
      created_at: new Date().toISOString(),
      delivered_at: null,
    };

    // Enforce PENDING_CAP: drop oldest pending events (FIFO) to make room
    if (full.target_agent) {
      const pendingCount = this.db.getPendingCount(full.target_agent);
      if (pendingCount >= PENDING_CAP) {
        const overflow = pendingCount - PENDING_CAP + 1;
        this.db.deleteOldestPending(full.target_agent, overflow);
      }
    }

    this.db.insertEvent(full);

    // Attempt immediate delivery
    if (full.target_agent) {
      this.notify(full.target_agent, full);
    }

    return full;
  }

  subscribe(
    agentId: string,
    callback: (event: SocialEvent) => void,
  ): () => void {
    let callbacks = this.subscribers.get(agentId);
    if (!callbacks) {
      callbacks = new Set();
      this.subscribers.set(agentId, callbacks);
    }
    callbacks.add(callback);

    return () => {
      callbacks!.delete(callback);
      if (callbacks!.size === 0) {
        this.subscribers.delete(agentId);
      }
    };
  }

  poll(agentId: string): SocialEvent[] {
    const events = this.db.getPendingEvents(agentId);
    for (const event of events) {
      this.db.markDelivered(event.id);
    }
    return events;
  }

  notify(agentId: string, event: SocialEvent): void {
    const callbacks = this.subscribers.get(agentId);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
    // If no subscriber, event stays pending in DB for poll()
  }

  getPendingCount(agentId: string): number {
    return this.db.getPendingCount(agentId);
  }
}
