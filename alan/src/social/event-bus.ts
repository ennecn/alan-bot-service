/**
 * EventBus — Core event routing service.
 */

import { randomUUID } from 'node:crypto';
import type { EventBusDB } from './event-bus-db.js';
import type { SocialEvent, EventType } from './types.js';

const PENDING_CAP = 500;

export class EventBus {
  private subscribers = new Map<string, Set<(event: SocialEvent) => void>>();

  constructor(private db: EventBusDB) {}

  publish(
    event: Omit<SocialEvent, 'id' | 'created_at' | 'delivered_at'>,
  ): SocialEvent {
    const full: SocialEvent = {
      ...event,
      id: randomUUID(),
      created_at: new Date().toISOString(),
      delivered_at: null,
    };

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
