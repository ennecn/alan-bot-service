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
  // Apply migrations
  db.exec(`CREATE TABLE IF NOT EXISTS agent_ratings (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT NOT NULL,
    score REAL NOT NULL CHECK(score BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(agent_id, user_id)
  )`);
  const cols = db.prepare("PRAGMA table_info(agents)").all() as any[];
  if (!cols.some((c: any) => c.name === 'creator_id')) {
    db.exec("ALTER TABLE agents ADD COLUMN creator_id TEXT");
    db.exec("ALTER TABLE agents ADD COLUMN photos TEXT DEFAULT '[]'");
    db.exec("ALTER TABLE agents ADD COLUMN tags TEXT DEFAULT '[]'");
    db.exec("ALTER TABLE agents ADD COLUMN rating REAL DEFAULT 0");
    db.exec("ALTER TABLE agents ADD COLUMN chat_count INTEGER DEFAULT 0");
    db.exec("ALTER TABLE agents ADD COLUMN friend_count INTEGER DEFAULT 0");
    db.exec("ALTER TABLE agents ADD COLUMN is_public INTEGER DEFAULT 0");
  }
  return db;
}

function createAgent(db: Database.Database, name: string, isPublic = false): string {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO agents (id, name, card_json, is_public) VALUES (?, ?, '{}', ?)`
  ).run(id, name, isPublic ? 1 : 0);
  return id;
}

describe('P1-B: Creature Metadata', () => {
  let db: Database.Database;
  let agentId: string;

  beforeEach(() => {
    db = createDb();
    agentId = createAgent(db, 'TestCreature', true);
  });
  afterEach(() => db.close());

  it('should update agent metadata', () => {
    db.prepare("UPDATE agents SET photos = ?, tags = ? WHERE id = ?")
      .run(JSON.stringify(['photo1.jpg']), JSON.stringify(['cute', 'friendly']), agentId);
    const row = db.prepare('SELECT photos, tags FROM agents WHERE id = ?').get(agentId) as any;
    expect(JSON.parse(row.photos)).toEqual(['photo1.jpg']);
    expect(JSON.parse(row.tags)).toEqual(['cute', 'friendly']);
  });

  it('should rate an agent and compute average', () => {
    db.prepare('INSERT INTO agent_ratings (id, agent_id, user_id, score) VALUES (?, ?, ?, ?)')
      .run('r1', agentId, 'user-a', 4);
    db.prepare('INSERT INTO agent_ratings (id, agent_id, user_id, score) VALUES (?, ?, ?, ?)')
      .run('r2', agentId, 'user-b', 2);
    const stats = db.prepare('SELECT AVG(score) as avg, COUNT(*) as cnt FROM agent_ratings WHERE agent_id = ?')
      .get(agentId) as any;
    expect(stats.avg).toBe(3);
    expect(stats.cnt).toBe(2);
  });

  it('should enforce unique rating per user', () => {
    db.prepare('INSERT INTO agent_ratings (id, agent_id, user_id, score) VALUES (?, ?, ?, ?)')
      .run('r1', agentId, 'user-a', 4);
    // Upsert
    db.prepare(
      `INSERT INTO agent_ratings (id, agent_id, user_id, score) VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, user_id) DO UPDATE SET score = excluded.score`
    ).run('r1', agentId, 'user-a', 5);
    const row = db.prepare('SELECT score FROM agent_ratings WHERE agent_id = ? AND user_id = ?')
      .get(agentId, 'user-a') as any;
    expect(row.score).toBe(5);
  });

  it('should increment chat_count', () => {
    db.prepare('UPDATE agents SET chat_count = chat_count + 1 WHERE id = ?').run(agentId);
    db.prepare('UPDATE agents SET chat_count = chat_count + 1 WHERE id = ?').run(agentId);
    const row = db.prepare('SELECT chat_count FROM agents WHERE id = ?').get(agentId) as any;
    expect(row.chat_count).toBe(2);
  });

  it('should filter public agents only in discovery', () => {
    const privateId = createAgent(db, 'PrivateBot', false);
    const rows = db.prepare('SELECT id FROM agents WHERE is_public = 1').all() as any[];
    expect(rows.map((r: any) => r.id)).toContain(agentId);
    expect(rows.map((r: any) => r.id)).not.toContain(privateId);
  });
});
