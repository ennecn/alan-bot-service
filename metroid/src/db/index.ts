import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { MetroidConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(config: MetroidConfig): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  const dbDir = dirname(config.dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.dbPath);

  // Apply schema
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // Migrations: add columns that may be missing from older DBs
  const agentCols = db.prepare("PRAGMA table_info(agents)").all() as any[];
  if (!agentCols.some((c: any) => c.name === 'mode')) {
    db.exec("ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic','enhanced'))");
  }

  // Migration: add embedding column for vector search
  const memoryCols = db.prepare("PRAGMA table_info(memories)").all() as any[];
  if (!memoryCols.some((c: any) => c.name === 'embedding')) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding BLOB");
  }

  // Migration: add entity_relations table for GraphRAG
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_relations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      source_entity TEXT NOT NULL,
      relation TEXT NOT NULL,
      target_entity TEXT NOT NULL,
      source_memory_id TEXT REFERENCES memories(id),
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entity_agent_source
      ON entity_relations(agent_id, source_entity);
    CREATE INDEX IF NOT EXISTS idx_entity_agent_target
      ON entity_relations(agent_id, target_entity);
  `);

  // Migration: add proactive_messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS proactive_messages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      trigger_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','idle','emotion','event','impulse:idle','impulse:emotion','impulse:mixed')),
      content TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_proactive_agent_pending
      ON proactive_messages(agent_id, delivered, created_at DESC);
  `);

  // Migration: update proactive_messages CHECK constraint for V2 trigger types
  const pmSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='proactive_messages'").get() as any)?.sql ?? '';
  if (pmSql && !pmSql.includes('impulse:idle')) {
    db.exec(`
      CREATE TABLE proactive_messages_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        trigger_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','idle','emotion','event','impulse:idle','impulse:emotion','impulse:mixed')),
        content TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO proactive_messages_new SELECT * FROM proactive_messages;
      DROP TABLE proactive_messages;
      ALTER TABLE proactive_messages_new RENAME TO proactive_messages;
      CREATE INDEX IF NOT EXISTS idx_proactive_agent_pending
        ON proactive_messages(agent_id, delivered, created_at DESC);
    `);
  }

  // Migration: add impulse_states table
  db.exec(`
    CREATE TABLE IF NOT EXISTS impulse_states (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      impulse_value REAL NOT NULL DEFAULT 0,
      last_decay_time TEXT NOT NULL DEFAULT (datetime('now')),
      last_fire_time TEXT,
      active_events TEXT NOT NULL DEFAULT '[]',
      suppression_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add long_term_mood table for cross-session emotional memory
  db.exec(`
    CREATE TABLE IF NOT EXISTS long_term_mood (
      agent_id TEXT NOT NULL REFERENCES agents(id),
      dimension TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, dimension)
    );
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
