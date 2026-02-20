import type Database from 'better-sqlite3';
import type { Memory } from '../../types.js';
import { MemoryStore } from './store.js';

const SCHEMA_VERSION = 1;

export interface MemorySnapshot {
  schemaVersion: number;
  agentId: string;
  exportedAt: string;
  memories: SnapshotMemory[];
}

interface SnapshotMemory {
  type: string;
  content: string;
  summary?: string;
  importance: number;
  confidence: number;
  privacy: string;
  keywords: string[];
  userId?: string;
  createdAt: string;
}

/** Export all active memories for an agent as a portable JSON snapshot */
export function exportSnapshot(db: Database.Database, agentId: string): MemorySnapshot {
  const rows = db.prepare(
    'SELECT * FROM memories WHERE agent_id = ? AND faded_at IS NULL ORDER BY created_at ASC'
  ).all(agentId) as any[];

  return {
    schemaVersion: SCHEMA_VERSION,
    agentId,
    exportedAt: new Date().toISOString(),
    memories: rows.map(r => ({
      type: r.type,
      content: r.content,
      summary: r.summary ?? undefined,
      importance: r.importance,
      confidence: r.confidence,
      privacy: r.privacy,
      keywords: r.keywords ? r.keywords.split(',') : [],
      userId: r.user_id ?? undefined,
      createdAt: r.created_at,
    })),
  };
}

/** Import a memory snapshot into an agent's memory store */
export function importSnapshot(store: MemoryStore, agentId: string, data: MemorySnapshot): { imported: number; skipped: number } {
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${data.schemaVersion} (expected ${SCHEMA_VERSION})`);
  }

  let imported = 0;
  let skipped = 0;

  for (const mem of data.memories) {
    try {
      store.create({
        agentId,
        type: mem.type as any,
        content: mem.content,
        summary: mem.summary,
        importance: mem.importance,
        confidence: mem.confidence,
        privacy: mem.privacy as any,
        keywords: mem.keywords,
        userId: mem.userId,
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  return { imported, skipped };
}
