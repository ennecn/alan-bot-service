/**
 * SocialPlatform — Posts, reactions, and relationship management.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SocialPost, Reaction, Relationship } from './types.js';

export class SocialPlatform {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        mood TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relationships (
        agent_a TEXT NOT NULL,
        agent_b TEXT NOT NULL,
        affinity REAL NOT NULL DEFAULT 0,
        last_interaction TEXT NOT NULL,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_a, agent_b)
      );
    `);
  }

  createPost(agentId: string, content: string, mood: string): SocialPost {
    const id = randomUUID();
    const created_at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO posts (id, agent_id, content, mood, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, agentId, content, mood, created_at);
    return { id, agent_id: agentId, content, mood, created_at, reactions: [] };
  }

  getPosts(limit = 50, agentId?: string): SocialPost[] {
    let query = `SELECT * FROM posts`;
    const params: unknown[] = [];
    if (agentId) {
      query += ` WHERE agent_id = ?`;
      params.push(agentId);
    }
    query += ` ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    params.push(limit);

    const posts = this.db.prepare(query).all(...params) as Array<
      Record<string, unknown>
    >;

    return posts.map((row) => {
      const postId = row.id as string;
      const reactions = this.db
        .prepare(`SELECT * FROM reactions WHERE post_id = ? ORDER BY created_at ASC`)
        .all(postId) as Array<Record<string, unknown>>;

      return {
        id: postId,
        agent_id: row.agent_id as string,
        content: row.content as string,
        mood: row.mood as string,
        created_at: row.created_at as string,
        reactions: reactions.map(this.parseReactionRow),
      };
    });
  }

  addReaction(
    postId: string,
    agentId: string,
    type: 'like' | 'comment',
    content?: string,
  ): Reaction {
    const id = randomUUID();
    const created_at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reactions (id, post_id, agent_id, type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, postId, agentId, type, content ?? null, created_at);
    return { id, post_id: postId, agent_id: agentId, type, content, created_at };
  }

  getRelationship(agentA: string, agentB: string): Relationship | null {
    const row = this.db
      .prepare(
        `SELECT * FROM relationships WHERE agent_a = ? AND agent_b = ?`,
      )
      .get(agentA, agentB) as Record<string, unknown> | undefined;
    return row ? this.parseRelationshipRow(row) : null;
  }

  updateAffinity(agentA: string, agentB: string, delta: number): void {
    const existing = this.getRelationship(agentA, agentB);
    const now = new Date().toISOString();

    if (existing) {
      const newAffinity = Math.max(-1, Math.min(1, existing.affinity + delta));
      this.db
        .prepare(
          `UPDATE relationships
           SET affinity = ?, last_interaction = ?, interaction_count = interaction_count + 1
           WHERE agent_a = ? AND agent_b = ?`,
        )
        .run(newAffinity, now, agentA, agentB);
    } else {
      const clamped = Math.max(-1, Math.min(1, delta));
      this.db
        .prepare(
          `INSERT INTO relationships (agent_a, agent_b, affinity, last_interaction, interaction_count)
           VALUES (?, ?, ?, ?, 1)`,
        )
        .run(agentA, agentB, clamped, now);
    }
  }

  decayRelationships(decayRate = 0.01): number {
    const result = this.db
      .prepare(`UPDATE relationships SET affinity = affinity * ?`)
      .run(1 - decayRate);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private parseReactionRow(row: Record<string, unknown>): Reaction {
    return {
      id: row.id as string,
      post_id: row.post_id as string,
      agent_id: row.agent_id as string,
      type: row.type as 'like' | 'comment',
      content: (row.content as string) ?? undefined,
      created_at: row.created_at as string,
    };
  }

  private parseRelationshipRow(row: Record<string, unknown>): Relationship {
    return {
      agent_a: row.agent_a as string,
      agent_b: row.agent_b as string,
      affinity: row.affinity as number,
      last_interaction: row.last_interaction as string,
      interaction_count: row.interaction_count as number,
    };
  }
}
