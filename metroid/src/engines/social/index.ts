import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  Engine, EngineContext, PromptFragment,
} from '../../types.js';
import type { IdentityEngine } from '../identity/index.js';

export type RelationshipType = 'acquaintance' | 'friend' | 'rival' | 'family' | 'romantic' | 'mentor';

export interface Relationship {
  id: string;
  agentA: string;
  agentB: string;
  type: RelationshipType;
  affinity: number;       // -1.0 to +1.0
  notes?: string;
  interactionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Social Engine Layer 0: Agent-to-agent relationship awareness.
 * Tracks relationships between agents and injects context into prompts.
 */
export class SocialEngine implements Engine {
  readonly name = 'social';

  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    private db: Database.Database,
    private identity: IdentityEngine,
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      getRelationships: this.db.prepare(`
        SELECT * FROM relationships
        WHERE agent_a = ? OR agent_b = ?
        ORDER BY affinity DESC
      `),
      getRelationship: this.db.prepare(`
        SELECT * FROM relationships
        WHERE (agent_a = ? AND agent_b = ?) OR (agent_a = ? AND agent_b = ?)
        LIMIT 1
      `),
      upsertRelationship: this.db.prepare(`
        INSERT INTO relationships (id, agent_a, agent_b, type, affinity, notes, interaction_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          affinity = excluded.affinity,
          notes = excluded.notes,
          interaction_count = excluded.interaction_count,
          updated_at = datetime('now')
      `),
      incrementInteraction: this.db.prepare(`
        UPDATE relationships SET interaction_count = interaction_count + 1, updated_at = datetime('now')
        WHERE id = ?
      `),
      updateAffinity: this.db.prepare(`
        UPDATE relationships SET affinity = ?, updated_at = datetime('now') WHERE id = ?
      `),
    };
  }

  /** Get all relationships for an agent */
  getRelationships(agentId: string): Relationship[] {
    const rows = this.stmts.getRelationships.all(agentId, agentId) as any[];
    return rows.map(this.rowToRelationship);
  }

  /** Get relationship between two specific agents */
  getRelationship(agentA: string, agentB: string): Relationship | undefined {
    const row = this.stmts.getRelationship.get(agentA, agentB, agentB, agentA) as any;
    return row ? this.rowToRelationship(row) : undefined;
  }

  /** Create or update a relationship */
  setRelationship(agentA: string, agentB: string, type: RelationshipType, affinity: number, notes?: string): Relationship {
    const existing = this.getRelationship(agentA, agentB);
    const id = existing?.id ?? randomUUID();
    const interactionCount = existing?.interactionCount ?? 0;
    this.stmts.upsertRelationship.run(
      id, agentA, agentB, type,
      Math.max(-1, Math.min(1, affinity)),
      notes ?? existing?.notes ?? null,
      interactionCount,
    );
    return this.getRelationship(agentA, agentB)!;
  }

  /** Inject relationship context into prompts */
  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    if (context.mode === 'classic') return [];

    const relationships = this.getRelationships(context.agentId);
    if (relationships.length === 0) return [];

    const lines = relationships.map(r => {
      const otherId = r.agentA === context.agentId ? r.agentB : r.agentA;
      const other = this.identity.getAgent(otherId);
      const name = other?.name ?? otherId;
      const affinityDesc = r.affinity > 0.5 ? '亲密' : r.affinity > 0 ? '友好' : r.affinity > -0.5 ? '一般' : '疏远';
      return `- ${name}: ${r.type} (${affinityDesc}${r.notes ? `, ${r.notes}` : ''})`;
    });

    const content = [
      '<relationships>',
      '你与其他角色的关系：',
      ...lines,
      '</relationships>',
    ].join('\n');

    return [{
      source: 'social',
      content,
      priority: 35,
      tokens: Math.ceil(content.length / 3),
      required: false,
    }];
  }

  /** After response: detect mentions of other agents and update affinity */
  async onResponse(response: string, context: EngineContext): Promise<void> {
    const allAgents = this.identity.getAllAgents();
    const currentAgent = context.agentId;

    for (const agent of allAgents) {
      if (agent.id === currentAgent) continue;

      // Check if the conversation mentions this agent by name
      const mentioned = context.message.content.includes(agent.name) ||
                        response.includes(agent.name);
      if (!mentioned) continue;

      // Get or create relationship
      let rel = this.getRelationship(currentAgent, agent.id);
      if (!rel) {
        rel = this.setRelationship(currentAgent, agent.id, 'acquaintance', 0.1);
      }

      // Increment interaction count
      this.stmts.incrementInteraction.run(rel.id);

      // Nudge affinity slightly positive on mention (capped)
      const newAffinity = Math.min(1, rel.affinity + 0.02);
      this.stmts.updateAffinity.run(newAffinity, rel.id);
    }
  }

  fallback(): PromptFragment[] {
    return [];
  }

  private rowToRelationship(row: any): Relationship {
    return {
      id: row.id,
      agentA: row.agent_a,
      agentB: row.agent_b,
      type: row.type as RelationshipType,
      affinity: row.affinity,
      notes: row.notes ?? undefined,
      interactionCount: row.interaction_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
