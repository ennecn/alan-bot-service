import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Memory, MemoryType, PrivacyLevel } from '../../types.js';

/** SQLite storage layer for memories. Pure CRUD, no business logic. */
export class MemoryStore {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO memories (id, agent_id, type, content, summary, importance,
          confidence, privacy, emotion_context, keywords, source_message_id,
          recall_count, created_at, last_recalled_at, faded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), ?, ?)
      `),

      getById: this.db.prepare(`SELECT * FROM memories WHERE id = ?`),

      updateImportance: this.db.prepare(
        `UPDATE memories SET importance = ?, faded_at = ? WHERE id = ?`
      ),

      recordRecall: this.db.prepare(`
        UPDATE memories
        SET recall_count = recall_count + 1, last_recalled_at = datetime('now')
        WHERE id = ?
      `),

      searchByKeywords: this.db.prepare(`
        SELECT * FROM memories
        WHERE agent_id = ? AND faded_at IS NULL AND keywords LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `),

      searchByTimeWindow: this.db.prepare(`
        SELECT * FROM memories
        WHERE agent_id = ? AND faded_at IS NULL AND created_at > datetime('now', ?)
        ORDER BY created_at DESC LIMIT ?
      `),

      getRecent: this.db.prepare(`
        SELECT * FROM memories
        WHERE agent_id = ? AND type = ? AND (faded_at IS NULL OR ? = 1)
        ORDER BY created_at DESC LIMIT ?
      `),

      getFadedCandidates: this.db.prepare(`
        SELECT * FROM memories
        WHERE agent_id = ? AND faded_at IS NULL AND importance < ?
        ORDER BY importance ASC LIMIT ?
      `),

      fade: this.db.prepare(`UPDATE memories SET faded_at = datetime('now') WHERE id = ?`),
    };
  }

  create(memory: Omit<Memory, 'id' | 'recallCount' | 'createdAt'>): Memory {
    const id = randomUUID();
    const now = new Date();
    this.stmts.insert.run(
      id, memory.agentId, memory.type, memory.content,
      memory.summary ?? null, memory.importance, memory.confidence,
      memory.privacy, memory.emotionContext ? JSON.stringify(memory.emotionContext) : null,
      memory.keywords.join(','), memory.sourceMessageId ?? null,
      0, now.toISOString(), null, null,
    );
    return { ...memory, id, recallCount: 0, createdAt: now };
  }

  getById(id: string): Memory | null {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToMemory(row) : null;
  }

  searchByKeyword(agentId: string, keyword: string, limit = 100): Memory[] {
    const rows = this.stmts.searchByKeywords.all(agentId, `%${keyword}%`, limit) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  searchByTimeWindow(agentId: string, hours: number, limit = 100): Memory[] {
    const rows = this.stmts.searchByTimeWindow.all(agentId, `-${hours} hours`, limit) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  getRecent(agentId: string, type: MemoryType, limit = 10, includeFaded = false): Memory[] {
    const rows = this.stmts.getRecent.all(agentId, type, includeFaded ? 1 : 0, limit) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  recordRecall(id: string): void {
    this.stmts.recordRecall.run(id);
  }

  updateImportance(id: string, importance: number): void {
    const fadedAt = importance < 0.3 ? new Date().toISOString() : null;
    this.stmts.updateImportance.run(importance, fadedAt, id);
  }

  getFadedCandidates(agentId: string, threshold: number, limit = 50): Memory[] {
    const rows = this.stmts.getFadedCandidates.all(agentId, threshold, limit) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  fade(id: string): void {
    this.stmts.fade.run(id);
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type as MemoryType,
      content: row.content,
      summary: row.summary ?? undefined,
      importance: row.importance,
      confidence: row.confidence,
      privacy: row.privacy as PrivacyLevel,
      emotionContext: row.emotion_context ? JSON.parse(row.emotion_context) : undefined,
      keywords: row.keywords ? row.keywords.split(',') : [],
      sourceMessageId: row.source_message_id ?? undefined,
      recallCount: row.recall_count,
      createdAt: new Date(row.created_at),
      lastRecalledAt: row.last_recalled_at ? new Date(row.last_recalled_at) : undefined,
      fadedAt: row.faded_at ? new Date(row.faded_at) : undefined,
    };
  }
}