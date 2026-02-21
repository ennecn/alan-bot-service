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
  db.exec(`CREATE TABLE IF NOT EXISTS feed_entries (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, type TEXT NOT NULL,
    content TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS feed_reactions (
    id TEXT PRIMARY KEY, feed_entry_id TEXT NOT NULL, user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'like', content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(feed_entry_id, user_id, type)
  )`);
  return db;
}

function createAgent(db: Database.Database): string {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO agents (id, name, card_json) VALUES (?, ?, '{}')`).run(id, 'TestBot');
  return id;
}

describe('P2-B: Feed Reactions', () => {
  let db: Database.Database;
  let agentId: string;
  let feedId: string;

  beforeEach(() => {
    db = createDb();
    agentId = createAgent(db);
    feedId = `feed-${Date.now()}`;
    db.prepare('INSERT INTO feed_entries (id, agent_id, type, content) VALUES (?, ?, ?, ?)')
      .run(feedId, agentId, 'mood', 'Feeling great!');
  });
  afterEach(() => db.close());

  it('should add a reaction', () => {
    db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type) VALUES (?, ?, ?, ?)')
      .run('r1', feedId, 'user-a', 'like');
    const row = db.prepare('SELECT * FROM feed_reactions WHERE feed_entry_id = ?').get(feedId) as any;
    expect(row.user_id).toBe('user-a');
    expect(row.type).toBe('like');
  });

  it('should enforce unique reaction per user+type', () => {
    db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type) VALUES (?, ?, ?, ?)')
      .run('r1', feedId, 'user-a', 'like');
    expect(() => {
      db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type) VALUES (?, ?, ?, ?)')
        .run('r2', feedId, 'user-a', 'like');
    }).toThrow();
  });

  it('should allow different reaction types from same user', () => {
    db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type) VALUES (?, ?, ?, ?)')
      .run('r1', feedId, 'user-a', 'like');
    db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type, content) VALUES (?, ?, ?, ?, ?)')
      .run('r2', feedId, 'user-a', 'comment', 'Nice!');
    const rows = db.prepare('SELECT * FROM feed_reactions WHERE feed_entry_id = ?').all(feedId) as any[];
    expect(rows).toHaveLength(2);
  });

  it('should list reactions for a feed entry', () => {
    db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type) VALUES (?, ?, ?, ?)')
      .run('r1', feedId, 'user-a', 'like');
    db.prepare('INSERT INTO feed_reactions (id, feed_entry_id, user_id, type) VALUES (?, ?, ?, ?)')
      .run('r2', feedId, 'user-b', 'like');
    const rows = db.prepare(
      'SELECT user_id, type FROM feed_reactions WHERE feed_entry_id = ? ORDER BY created_at DESC'
    ).all(feedId) as any[];
    expect(rows).toHaveLength(2);
  });

  it('should upsert reaction (update content on conflict)', () => {
    db.prepare(
      `INSERT INTO feed_reactions (id, feed_entry_id, user_id, type, content) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(feed_entry_id, user_id, type) DO UPDATE SET content = excluded.content`
    ).run('r1', feedId, 'user-a', 'comment', 'First comment');
    db.prepare(
      `INSERT INTO feed_reactions (id, feed_entry_id, user_id, type, content) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(feed_entry_id, user_id, type) DO UPDATE SET content = excluded.content`
    ).run('r1', feedId, 'user-a', 'comment', 'Updated comment');
    const row = db.prepare('SELECT content FROM feed_reactions WHERE feed_entry_id = ? AND user_id = ? AND type = ?')
      .get(feedId, 'user-a', 'comment') as any;
    expect(row.content).toBe('Updated comment');
  });
});
