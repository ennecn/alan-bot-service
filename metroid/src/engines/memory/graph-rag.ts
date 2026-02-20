import type Database from 'better-sqlite3';
import type { MetroidConfig } from '../../config.js';

export interface EntityRelation {
  id: string;
  agentId: string;
  sourceEntity: string;
  relation: string;
  targetEntity: string;
  sourceMemoryId?: string;
  weight: number;
  createdAt: Date;
}

/**
 * GraphRAG: entity-relation extraction and graph-based memory retrieval.
 * Extracts (entity, relation, entity) triples from conversation.
 * Queries use shallow graph traversal (1-2 hops) to find related memories.
 */
export class GraphRAG {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    private db: Database.Database,
    private config: MetroidConfig,
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT OR IGNORE INTO entity_relations
          (id, agent_id, source_entity, relation, target_entity, source_memory_id, weight)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),

      findByEntity: this.db.prepare(`
        SELECT * FROM entity_relations
        WHERE agent_id = ? AND (source_entity = ? OR target_entity = ?)
        ORDER BY weight DESC LIMIT ?
      `),

      findConnected: this.db.prepare(`
        SELECT DISTINCT
          CASE WHEN source_entity = ? THEN target_entity ELSE source_entity END as connected,
          relation, weight
        FROM entity_relations
        WHERE agent_id = ? AND (source_entity = ? OR target_entity = ?)
        ORDER BY weight DESC LIMIT ?
      `),

      getMemoryIds: this.db.prepare(`
        SELECT DISTINCT source_memory_id FROM entity_relations
        WHERE agent_id = ? AND (source_entity IN (SELECT value FROM json_each(?))
          OR target_entity IN (SELECT value FROM json_each(?)))
        AND source_memory_id IS NOT NULL
        LIMIT ?
      `),

      incrementWeight: this.db.prepare(`
        UPDATE entity_relations SET weight = weight + 0.5
        WHERE agent_id = ? AND source_entity = ? AND relation = ? AND target_entity = ?
      `),
    };
  }

  /** Extract entity-relation triples from text using LLM */
  async extractRelations(
    agentId: string,
    text: string,
    memoryId?: string,
  ): Promise<void> {
    if (text.length < 30) return;

    try {
      const triples = await this.callLLMForExtraction(text);
      for (const t of triples) {
        const id = `${agentId}-${t.source}-${t.relation}-${t.target}`;
        // Try to increment weight if relation exists, otherwise insert
        const changes = this.stmts.incrementWeight.run(agentId, t.source, t.relation, t.target);
        if (changes.changes === 0) {
          this.stmts.insert.run(id, agentId, t.source, t.relation, t.target, memoryId ?? null, 1.0);
        }
      }
    } catch (err) {
      console.warn('[GraphRAG] Extraction failed:', err);
    }
  }

  /** Find entities related to query text (1-hop traversal) */
  findRelatedEntities(agentId: string, entities: string[], limit = 20): string[] {
    const related = new Set<string>();
    for (const entity of entities) {
      const rows = this.stmts.findConnected.all(agentId, entity, agentId, entity, entity, limit) as any[];
      for (const r of rows) {
        related.add(r.connected);
      }
    }
    return [...related];
  }

  /** Find memory IDs connected to given entities (for retrieval boost) */
  findRelatedMemoryIds(agentId: string, entities: string[], limit = 30): string[] {
    if (entities.length === 0) return [];
    const json = JSON.stringify(entities);
    const rows = this.stmts.getMemoryIds.all(agentId, json, json, limit) as any[];
    return rows.map(r => r.source_memory_id).filter(Boolean);
  }

  /** Extract entities from text using simple pattern matching (fast, no LLM) */
  extractEntitiesLocal(text: string): string[] {
    const entities: string[] = [];

    // Chinese names (2-4 chars, common surname patterns)
    const cnNames = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
    entities.push(...cnNames.filter(n => n.length >= 2 && n.length <= 4));

    // English proper nouns (capitalized words)
    const enNames = text.match(/\b[A-Z][a-z]{1,15}\b/g) || [];
    entities.push(...enNames);

    // Deduplicate
    return [...new Set(entities)].slice(0, 10);
  }

  /** Call LLM to extract (source, relation, target) triples */
  private async callLLMForExtraction(
    text: string,
  ): Promise<Array<{ source: string; relation: string; target: string }>> {
    const baseUrl = this.config.llm.openaiBaseUrl;
    const apiKey = this.config.llm.openaiApiKey || this.config.llm.apiKey;
    if (!baseUrl || !apiKey) return [];

    const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llm.openaiModel || this.config.llm.lightModel,
        messages: [{
          role: 'user',
          content: `Extract entity relationships from this text. Return a JSON array of triples.
Each triple: {"source": "entity1", "relation": "relationship", "target": "entity2"}
Focus on: people, places, events, emotions, preferences.
Keep entities short (1-4 words). Keep relations simple (likes, dislikes, went_to, feels, knows, etc.)

Text: "${text.slice(0, 1000)}"

Return ONLY a JSON array, no other text. If no relations found, return [].`,
        }],
        max_tokens: 500,
      }),
    });

    if (!resp.ok) return [];
    const result = await resp.json() as any;
    const raw = result.choices?.[0]?.message?.content || '';

    try {
      const parsed = JSON.parse(raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim());
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((t: any) => t.source && t.relation && t.target);
    } catch {
      return [];
    }
  }
}
