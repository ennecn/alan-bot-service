/**
 * FactSync — Fact synchronization between agents.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { EventBus } from './event-bus.js';
import type { FactUpdate } from './types.js';

export class FactSync {
  private facts = new Map<string, FactUpdate>();

  constructor(private eventBus: EventBus) {}

  broadcast(sourceAgent: string, content: string): FactUpdate {
    const contentHash = createHash('sha256').update(content).digest('hex');

    // Dedup: if same content already exists, return existing
    const existing = this.getFactByHash(contentHash);
    if (existing) return existing;

    const fact: FactUpdate = {
      id: randomUUID(),
      source_agent: sourceAgent,
      content,
      content_hash: contentHash,
      accepted_by: [],
      rejected_by: [],
      created_at: new Date().toISOString(),
    };

    this.facts.set(fact.id, fact);

    this.eventBus.publish({
      source_agent: sourceAgent,
      target_agent: null,
      type: 'fact_update',
      payload: { fact_id: fact.id, content },
    });

    return fact;
  }

  accept(factId: string, agentId: string): void {
    const fact = this.facts.get(factId);
    if (!fact) return;
    if (!fact.accepted_by.includes(agentId)) {
      fact.accepted_by.push(agentId);
    }
  }

  reject(factId: string, agentId: string): void {
    const fact = this.facts.get(factId);
    if (!fact) return;
    if (!fact.rejected_by.includes(agentId)) {
      fact.rejected_by.push(agentId);
    }
  }

  getFact(factId: string): FactUpdate | null {
    return this.facts.get(factId) ?? null;
  }

  getFactByHash(hash: string): FactUpdate | null {
    for (const fact of this.facts.values()) {
      if (fact.content_hash === hash) return fact;
    }
    return null;
  }

  getAllFacts(): FactUpdate[] {
    return Array.from(this.facts.values());
  }
}
