/**
 * AgentRegistry — Agent registration and lifecycle management.
 */

import type { EventBusDB } from './event-bus-db.js';
import type { AgentInfo, AgentStatus } from './types.js';

const DORMANT_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours

export class AgentRegistry {
  constructor(private db: EventBusDB) {}

  register(
    id: string,
    name: string,
    metadata: Record<string, unknown> = {},
  ): AgentInfo {
    const now = new Date().toISOString();
    const agent: AgentInfo = {
      id,
      name,
      status: 'online',
      last_seen: now,
      metadata,
      registered_at: now,
    };
    this.db.registerAgent(agent);
    return agent;
  }

  deregister(id: string): void {
    this.db.updateAgent(id, { status: 'retired' });
  }

  heartbeat(id: string): void {
    const agent = this.db.getAgent(id);
    if (!agent) return;

    const updates: Partial<AgentInfo> = {
      last_seen: new Date().toISOString(),
    };
    if (agent.status === 'offline') {
      updates.status = 'online';
    }
    this.db.updateAgent(id, updates);
  }

  getAgent(id: string): AgentInfo | null {
    return this.db.getAgent(id);
  }

  getOnlineAgents(): AgentInfo[] {
    return this.db.getAgentsByStatus('online');
  }

  getAllAgents(): AgentInfo[] {
    return this.db.getAllAgents();
  }

  checkDormant(): string[] {
    const now = Date.now();
    const agents = this.db.getAgentsByStatus('offline');
    const dormantIds: string[] = [];

    for (const agent of agents) {
      const lastSeen = new Date(agent.last_seen).getTime();
      if (now - lastSeen > DORMANT_THRESHOLD_MS) {
        this.db.updateAgent(agent.id, { status: 'dormant' });
        dormantIds.push(agent.id);
      }
    }

    return dormantIds;
  }
}
