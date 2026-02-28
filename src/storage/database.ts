/**
 * SQLite database initialization and schema migration.
 * Uses better-sqlite3 for synchronous access.
 */

import Database from 'better-sqlite3';
import path from 'node:path';

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_session ON chat_history(session_id, timestamp)`,
    `CREATE TABLE IF NOT EXISTS chat_history_archive (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_archive_session ON chat_history_archive(session_id, timestamp)`,
    `CREATE TABLE IF NOT EXISTS wi_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      keys TEXT NOT NULL,
      config TEXT NOT NULL,
      embedding BLOB,
      embedding_status TEXT DEFAULT 'pending'
    )`,
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`,
    `INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`,
  ],
};

export function initDatabase(workspacePath: string): Database.Database {
  const dbPath = path.join(workspacePath, 'internal', 'memory.sqlite');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  const hasVersionTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
    .get();

  if (!hasVersionTable) {
    const stmts = MIGRATIONS[1];
    db.transaction(() => {
      for (const sql of stmts) {
        db.exec(sql);
      }
    })();
    return;
  }

  const row = db.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    db.transaction(() => {
      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        const stmts = MIGRATIONS[v];
        if (stmts) {
          for (const sql of stmts) {
            db.exec(sql);
          }
        }
      }
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    })();
  }
}
