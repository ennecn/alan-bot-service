import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { MetroidMessage } from '../../types.js';

export interface Session {
  id: string;
  agentId: string;
  userId?: string;
  startedAt: Date;
  endedAt?: Date;
  summary?: string;
}

export interface SessionMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  authorName?: string;
  createdAt: Date;
}

/**
 * Session Engine: tracks conversation sessions for cross-session continuity.
 * New sessions auto-load context from the previous session.
 */
export class SessionEngine {
  private stmts: ReturnType<typeof this.prepare>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepare();
  }

  private prepare() {
    return {
      createSession: this.db.prepare(
        `INSERT INTO sessions (id, agent_id, user_id, started_at) VALUES (?, ?, ?, datetime(?))`
      ),
      endSession: this.db.prepare(
        `UPDATE sessions SET ended_at = datetime(?), summary = ? WHERE id = ?`
      ),
      getSession: this.db.prepare(
        `SELECT * FROM sessions WHERE id = ?`
      ),
      getLatestSession: this.db.prepare(
        `SELECT * FROM sessions WHERE agent_id = ? AND (user_id = ? OR user_id IS NULL)
         ORDER BY started_at DESC LIMIT 1`
      ),
      listSessions: this.db.prepare(
        `SELECT * FROM sessions WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?`
      ),
      addMessage: this.db.prepare(
        `INSERT INTO session_messages (session_id, role, content, author_name, created_at)
         VALUES (?, ?, ?, ?, datetime(?))`
      ),
      getMessages: this.db.prepare(
        `SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`
      ),
      getRecentMessages: this.db.prepare(
        `SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
      ),
    };
  }

  /** Start a new session, returning previous session's tail messages for context */
  startSession(agentId: string, userId?: string): { session: Session; previousContext: SessionMessage[] } {
    // Find previous session BEFORE creating the new one
    const prevRow = this.stmts.getLatestSession.get(agentId, userId ?? null) as any;
    let previousContext: SessionMessage[] = [];
    if (prevRow) {
      const rows = this.stmts.getRecentMessages.all(prevRow.id, 10) as any[];
      previousContext = rows.map(r => this.rowToMessage(r)).reverse(); // chronological order
    }

    const id = randomUUID();
    const now = new Date();
    this.stmts.createSession.run(id, agentId, userId ?? null, now.toISOString());

    const session: Session = { id, agentId, userId, startedAt: now };
    return { session, previousContext };
  }

  /** End a session with optional summary */
  endSession(sessionId: string, summary?: string): void {
    this.stmts.endSession.run(new Date().toISOString(), summary ?? null, sessionId);
  }

  /** Record a message in the current session */
  addMessage(sessionId: string, role: 'user' | 'assistant', content: string, authorName?: string): void {
    this.stmts.addMessage.run(sessionId, role, content, authorName ?? null, new Date().toISOString());
  }

  /** Get all messages for a session */
  getMessages(sessionId: string, limit = 100): SessionMessage[] {
    const rows = this.stmts.getMessages.all(sessionId, limit) as any[];
    return rows.map(r => this.rowToMessage(r));
  }

  /** List sessions for an agent */
  listSessions(agentId: string, limit = 20): Session[] {
    const rows = this.stmts.listSessions.all(agentId, limit) as any[];
    return rows.map(r => this.rowToSession(r));
  }

  /** Get a session by ID */
  getSession(sessionId: string): Session | undefined {
    const row = this.stmts.getSession.get(sessionId) as any;
    return row ? this.rowToSession(row) : undefined;
  }

  private rowToSession(row: any): Session {
    return {
      id: row.id,
      agentId: row.agent_id,
      userId: row.user_id ?? undefined,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      summary: row.summary ?? undefined,
    };
  }

  private rowToMessage(row: any): SessionMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      authorName: row.author_name ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
