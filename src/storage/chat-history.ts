/**
 * ChatHistoryStore — read/write chat messages in SQLite.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface ChatMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
  metadata?: string;
}

export class ChatHistoryStore {
  constructor(private db: Database.Database) {}

  write(sessionId: string, role: string, content: string, metadata?: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO chat_history (session_id, role, content, timestamp, metadata)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, role, content, new Date().toISOString(), metadata ? JSON.stringify(metadata) : null);
  }

  getRecent(sessionId: string, limit: number): ChatMessage[] {
    return this.db
      .prepare(
        `SELECT * FROM chat_history
         WHERE session_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(sessionId, limit) as ChatMessage[];
  }

  /**
   * Returns the current session ID, or creates a new one if the last
   * interaction was longer than timeoutHours ago.
   */
  getOrCreateSession(lastInteractionTime: string | null, timeoutHours: number): string {
    if (lastInteractionTime) {
      const elapsed = Date.now() - new Date(lastInteractionTime).getTime();
      const timeoutMs = timeoutHours * 3600_000;
      if (elapsed < timeoutMs) {
        // Find the most recent session
        const row = this.db
          .prepare(`SELECT session_id FROM chat_history ORDER BY timestamp DESC LIMIT 1`)
          .get() as { session_id: string } | undefined;
        if (row) return row.session_id;
      }
    }
    return randomUUID();
  }

  /** Move messages older than 30 days to the archive table. */
  archive(): number {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const result = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO chat_history_archive (session_id, role, content, timestamp, metadata)
           SELECT session_id, role, content, timestamp, metadata
           FROM chat_history WHERE timestamp < ?`
        )
        .run(cutoff);
      const del = this.db.prepare(`DELETE FROM chat_history WHERE timestamp < ?`).run(cutoff);
      return del.changes;
    })();
    return result;
  }
}
