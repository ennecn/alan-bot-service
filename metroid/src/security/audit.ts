import type Database from 'better-sqlite3';
import type { AuditEntry } from '../types.js';

/**
 * Append-only audit log. Every state change goes through here.
 * From 阿凛's feedback: security from Day 1.
 */
export class AuditLog {
  private insertStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO audit_log (timestamp, actor, action, target, details, approved_by)
      VALUES (datetime(?), ?, ?, ?, ?, ?)
    `);
  }

  async log(entry: AuditEntry): Promise<void> {
    this.insertStmt.run(
      (entry.timestamp ?? new Date()).toISOString(),
      entry.actor,
      entry.action,
      entry.target ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.approvedBy ?? null,
    );
  }

  /** Query recent audit entries */
  getRecent(limit = 50): AuditEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?`
    ).all(limit) as any[];

    return rows.map(r => ({
      id: r.id,
      timestamp: new Date(r.timestamp),
      actor: r.actor,
      action: r.action,
      target: r.target ?? undefined,
      details: r.details ? JSON.parse(r.details) : undefined,
      approvedBy: r.approved_by ?? undefined,
    }));
  }

  /** Query audit entries by actor */
  getByActor(actor: string, limit = 50): AuditEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM audit_log WHERE actor = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(actor, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      timestamp: new Date(r.timestamp),
      actor: r.actor,
      action: r.action,
      target: r.target ?? undefined,
      details: r.details ? JSON.parse(r.details) : undefined,
      approvedBy: r.approved_by ?? undefined,
    }));
  }
}
