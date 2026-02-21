import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../src/db/schema.sql');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(schemaPath, 'utf-8'));
  const cols = db.prepare("PRAGMA table_info(agents)").all() as any[];
  if (!cols.some((c: any) => c.name === 'is_public')) {
    db.exec("ALTER TABLE agents ADD COLUMN creator_id TEXT");
    db.exec("ALTER TABLE agents ADD COLUMN photos TEXT DEFAULT '[]'");
    db.exec("ALTER TABLE agents ADD COLUMN tags TEXT DEFAULT '[]'");
    db.exec("ALTER TABLE agents ADD COLUMN rating REAL DEFAULT 0");
    db.exec("ALTER TABLE agents ADD COLUMN chat_count INTEGER DEFAULT 0");
    db.exec("ALTER TABLE agents ADD COLUMN friend_count INTEGER DEFAULT 0");
    db.exec("ALTER TABLE agents ADD COLUMN is_public INTEGER DEFAULT 0");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), last_chat_at TEXT,
    UNIQUE(user_id, agent_id)
  )`);
  return db;
}

function createAgent(db: Database.Database, name: string, opts: { isPublic?: boolean; rating?: number; tags?: string[]; chatCount?: number } = {}): string {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO agents (id, name, card_json, is_public, rating, tags, chat_count) VALUES (?, ?, '{}', ?, ?, ?, ?)`
  ).run(id, name, opts.isPublic ? 1 : 0, opts.rating ?? 0, JSON.stringify(opts.tags ?? []), opts.chatCount ?? 0);
  return id;
}

describe('P2-A: Discovery API', () => {
  let db: Database.Database;

  beforeEach(() => { db = createDb(); });
  afterEach(() => db.close());

  it('should only return public agents', () => {
    createAgent(db, 'Public1', { isPublic: true, rating: 4 });
    createAgent(db, 'Private1', { isPublic: false, rating: 5 });
    const rows = db.prepare('SELECT id, name FROM agents WHERE is_public = 1').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Public1');
  });

  it('should sort by rating then chat_count', () => {
    createAgent(db, 'LowRating', { isPublic: true, rating: 2, chatCount: 100 });
    createAgent(db, 'HighRating', { isPublic: true, rating: 5, chatCount: 10 });
    createAgent(db, 'MidRating', { isPublic: true, rating: 5, chatCount: 50 });
    const rows = db.prepare(
      'SELECT name FROM agents WHERE is_public = 1 ORDER BY rating DESC, chat_count DESC'
    ).all() as any[];
    expect(rows[0].name).toBe('MidRating');
    expect(rows[1].name).toBe('HighRating');
    expect(rows[2].name).toBe('LowRating');
  });

  it('should filter by tags', () => {
    createAgent(db, 'CuteBot', { isPublic: true, tags: ['cute', 'friendly'] });
    createAgent(db, 'DarkBot', { isPublic: true, tags: ['dark', 'mysterious'] });
    const rows = db.prepare(
      `SELECT name FROM agents WHERE is_public = 1 AND tags LIKE ?`
    ).all('%"cute"%') as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('CuteBot');
  });

  it('should exclude specified IDs', () => {
    const id1 = createAgent(db, 'Bot1', { isPublic: true });
    createAgent(db, 'Bot2', { isPublic: true });
    const rows = db.prepare(
      'SELECT name FROM agents WHERE is_public = 1 AND id NOT IN (?)'
    ).all(id1) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bot2');
  });

  it('should exclude already-friended agents in recommended', () => {
    const id1 = createAgent(db, 'Friend', { isPublic: true });
    createAgent(db, 'Stranger', { isPublic: true });
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f1', 'user-a', id1);
    const friendIds = db.prepare('SELECT agent_id FROM friendships WHERE user_id = ?')
      .all('user-a').map((r: any) => r.agent_id);
    expect(friendIds).toContain(id1);
    const rows = db.prepare(
      `SELECT name FROM agents WHERE is_public = 1 AND id NOT IN (${friendIds.map(() => '?').join(',')})`
    ).all(...friendIds) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Stranger');
  });
});
