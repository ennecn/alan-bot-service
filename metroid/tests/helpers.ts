import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../src/db/schema.sql');

/** Create a fresh in-memory database with schema applied */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

/** Insert a test agent and return its id */
export function createTestAgent(db: Database.Database, name = 'test-agent'): string {
  const id = `agent-${Date.now()}`;
  db.prepare(
    `INSERT INTO agents (id, name, card_json) VALUES (?, ?, '{}')`
  ).run(id, name);
  return id;
}
