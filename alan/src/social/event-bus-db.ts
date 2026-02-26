/**
 * EventBusDB — SQLite storage for social events and agent registry.
 */

import Database from 'better-sqlite3';
import type { SocialEvent, AgentInfo } from './types.js';

export class EventBusDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        source_agent TEXT NOT NULL,
        target_agent TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        registered_at TEXT NOT NULL
      );
    `);
  }

  insertEvent(event: SocialEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (id, source_agent, target_agent, type, payload, created_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.source_agent,
        event.target_agent,
        event.type,
        JSON.stringify(event.payload),
        event.created_at,
        event.delivered_at,
      );
  }

  getPendingEvents(agentId: string, limit = 500): SocialEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE target_agent = ? AND delivered_at IS NULL
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(agentId, limit) as Array<Record<string, unknown>>;
    return rows.map(this.parseEventRow);
  }

  markDelivered(eventId: string): void {
    this.db
      .prepare(`UPDATE events SET delivered_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), eventId);
  }

  getRecentEvents(limit = 50): SocialEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM events ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(this.parseEventRow);
  }

  getPendingCount(agentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM events
         WHERE target_agent = ? AND delivered_at IS NULL`,
      )
      .get(agentId) as { cnt: number };
    return row.cnt;
  }

  deleteOldestPending(agentId: string, count: number): void {
    this.db
      .prepare(
        `DELETE FROM events WHERE id IN (
           SELECT id FROM events
           WHERE target_agent = ? AND delivered_at IS NULL
           ORDER BY created_at ASC
           LIMIT ?
         )`,
      )
      .run(agentId, count);
  }

  registerAgent(agent: AgentInfo): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agents (id, name, status, last_seen, metadata, registered_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        agent.name,
        agent.status,
        agent.last_seen,
        JSON.stringify(agent.metadata),
        agent.registered_at,
      );
  }

  updateAgent(id: string, updates: Partial<AgentInfo>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.last_seen !== undefined) {
      fields.push('last_seen = ?');
      values.push(updates.last_seen);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db
      .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  getAgent(id: string): AgentInfo | null {
    const row = this.db
      .prepare(`SELECT * FROM agents WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.parseAgentRow(row) : null;
  }

  getAllAgents(): AgentInfo[] {
    const rows = this.db
      .prepare(`SELECT * FROM agents`)
      .all() as Array<Record<string, unknown>>;
    return rows.map(this.parseAgentRow);
  }

  getAgentsByStatus(status: string): AgentInfo[] {
    const rows = this.db
      .prepare(`SELECT * FROM agents WHERE status = ?`)
      .all(status) as Array<Record<string, unknown>>;
    return rows.map(this.parseAgentRow);
  }

  close(): void {
    this.db.close();
  }

  private parseEventRow(row: Record<string, unknown>): SocialEvent {
    return {
      id: row.id as string,
      source_agent: row.source_agent as string,
      target_agent: (row.target_agent as string) ?? null,
      type: row.type as SocialEvent['type'],
      payload: JSON.parse(row.payload as string),
      created_at: row.created_at as string,
      delivered_at: (row.delivered_at as string) ?? null,
    };
  }

  private parseAgentRow(row: Record<string, unknown>): AgentInfo {
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as AgentInfo['status'],
      last_seen: row.last_seen as string,
      metadata: JSON.parse(row.metadata as string),
      registered_at: row.registered_at as string,
    };
  }
}
