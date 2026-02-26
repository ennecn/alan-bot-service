/**
 * WIStore — World Info entries in SQLite with embedding support.
 */

import type Database from 'better-sqlite3';
import type { WIEntry } from '../types/actions.js';

export class WIStore {
  constructor(private db: Database.Database) {}

  upsertEntry(entry: WIEntry): void {
    const { id, content, keys, embedding, ...rest } = entry;
    const embeddingBlob =
      embedding && embedding !== 'pending'
        ? Buffer.from(new Float32Array(embedding).buffer)
        : null;
    const embeddingStatus =
      embedding && embedding !== 'pending' ? 'ready' : 'pending';

    this.db
      .prepare(
        `INSERT INTO wi_entries (id, content, keys, config, embedding, embedding_status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           keys = excluded.keys,
           config = excluded.config,
           embedding = excluded.embedding,
           embedding_status = excluded.embedding_status`
      )
      .run(
        id,
        content,
        JSON.stringify(keys),
        JSON.stringify(rest),
        embeddingBlob,
        embeddingStatus
      );
  }

  getAllEntries(): WIEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM wi_entries`)
      .all() as Array<{
        id: string;
        content: string;
        keys: string;
        config: string;
        embedding: Buffer | null;
        embedding_status: string;
      }>;

    return rows.map((row) => this.rowToEntry(row));
  }

  getPendingEmbeddings(): WIEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM wi_entries WHERE embedding_status = 'pending'`)
      .all() as Array<{
        id: string;
        content: string;
        keys: string;
        config: string;
        embedding: Buffer | null;
        embedding_status: string;
      }>;

    return rows.map((row) => this.rowToEntry(row));
  }

  updateEmbedding(id: string, embedding: number[]): void {
    const blob = Buffer.from(new Float32Array(embedding).buffer);
    this.db
      .prepare(`UPDATE wi_entries SET embedding = ?, embedding_status = 'ready' WHERE id = ?`)
      .run(blob, id);
  }

  private rowToEntry(row: {
    id: string;
    content: string;
    keys: string;
    config: string;
    embedding: Buffer | null;
    embedding_status: string;
  }): WIEntry {
    const config = JSON.parse(row.config) as Omit<WIEntry, 'id' | 'content' | 'keys' | 'embedding'>;
    const keys = JSON.parse(row.keys) as string[];
    let embedding: number[] | 'pending' | undefined;
    if (row.embedding) {
      embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
    } else if (row.embedding_status === 'pending') {
      embedding = 'pending';
    }
    return { id: row.id, content: row.content, keys, ...config, embedding };
  }
}
