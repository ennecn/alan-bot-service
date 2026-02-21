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
  db.exec(`CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), last_chat_at TEXT,
    UNIQUE(user_id, agent_id)
  )`);
  const cols = db.prepare("PRAGMA table_info(agents)").all() as any[];
  if (!cols.some((c: any) => c.name === 'friend_count')) {
    db.exec("ALTER TABLE agents ADD COLUMN friend_count INTEGER DEFAULT 0");
  }
  return db;
}

function createAgent(db: Database.Database, name: string): string {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO agents (id, name, card_json) VALUES (?, ?, '{}')`).run(id, name);
  return id;
}

describe('P1-C: Friendship System', () => {
  let db: Database.Database;
  let agentId: string;

  beforeEach(() => {
    db = createDb();
    agentId = createAgent(db, 'FriendBot');
  });
  afterEach(() => db.close());

  it('should add a friendship', () => {
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f1', 'user-a', agentId);
    const row = db.prepare('SELECT * FROM friendships WHERE user_id = ? AND agent_id = ?')
      .get('user-a', agentId) as any;
    expect(row).toBeTruthy();
    expect(row.user_id).toBe('user-a');
  });

  it('should enforce unique friendship per user+agent', () => {
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f1', 'user-a', agentId);
    expect(() => {
      db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
        .run('f2', 'user-a', agentId);
    }).toThrow();
  });

  it('should remove a friendship', () => {
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f1', 'user-a', agentId);
    db.prepare('DELETE FROM friendships WHERE user_id = ? AND agent_id = ?')
      .run('user-a', agentId);
    const row = db.prepare('SELECT * FROM friendships WHERE user_id = ? AND agent_id = ?')
      .get('user-a', agentId);
    expect(row).toBeUndefined();
  });

  it('should list friends for a user', () => {
    const agent2 = createAgent(db, 'FriendBot2');
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f1', 'user-a', agentId);
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f2', 'user-a', agent2);
    const rows = db.prepare(
      'SELECT f.agent_id, a.name FROM friendships f JOIN agents a ON f.agent_id = a.id WHERE f.user_id = ?'
    ).all('user-a') as any[];
    expect(rows).toHaveLength(2);
  });

  it('should update last_chat_at', () => {
    db.prepare('INSERT INTO friendships (id, user_id, agent_id) VALUES (?, ?, ?)')
      .run('f1', 'user-a', agentId);
    db.prepare("UPDATE friendships SET last_chat_at = datetime('now') WHERE user_id = ? AND agent_id = ?")
      .run('user-a', agentId);
    const row = db.prepare('SELECT last_chat_at FROM friendships WHERE user_id = ? AND agent_id = ?')
      .get('user-a', agentId) as any;
    expect(row.last_chat_at).toBeTruthy();
  });
});
