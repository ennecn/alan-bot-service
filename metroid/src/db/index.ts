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

  // Migration: add user_id column for multi-user memory isolation
  if (!memoryCols.some((c: any) => c.name === 'user_id')) {
    db.exec("ALTER TABLE memories ADD COLUMN user_id TEXT");
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
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','idle','emotion','event')),
      content TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_proactive_agent_pending
      ON proactive_messages(agent_id, delivered, created_at DESC);
  `);

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

  // Migration: add relationships table (Social Engine)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      agent_a TEXT NOT NULL REFERENCES agents(id),
      agent_b TEXT NOT NULL REFERENCES agents(id),
      type TEXT NOT NULL DEFAULT 'acquaintance' CHECK(type IN ('acquaintance','friend','rival','family','romantic','mentor')),
      affinity REAL NOT NULL DEFAULT 0.0,
      notes TEXT,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_relationships_agent_a ON relationships(agent_a);
    CREATE INDEX IF NOT EXISTS idx_relationships_agent_b ON relationships(agent_b);
  `);

  // Migration: add sessions table (cross-session continuity)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      user_id TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, started_at DESC);
  `);

  // Migration: add session_messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      author_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, created_at ASC);
  `);

  // Migration: add feed_entries table (Feed Engine)
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_entries (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      type TEXT NOT NULL CHECK(type IN ('thought','memory_echo','mood','milestone','reflection')),
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feed_agent ON feed_entries(agent_id, created_at DESC);
  `);

  // Migration: add conversations table (Multi-agent conversations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add conversation_participants table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, agent_id)
    );
  `);

  // Migration: add conversation_messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      agent_id TEXT,
      user_id TEXT,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      author_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conv_messages ON conversation_messages(conversation_id, created_at ASC);
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
