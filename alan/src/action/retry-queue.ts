/**
 * RetryQueue — JSONL-backed retry queue for failed non-critical actions.
 * Max 100 items, FIFO eviction. Items expire after 3 attempts or 1 hour.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Action } from '../types/actions.js';

export interface RetryItem {
  id: string;
  action: Action;
  error: string;
  attempts: number;
  created_at: string;
}

const MAX_ITEMS = 100;
const MAX_ATTEMPTS = 3;
const MAX_AGE_MS = 3600_000; // 1 hour

export class RetryQueue {
  private filePath: string;

  constructor(workspacePath: string) {
    const dir = path.join(workspacePath, 'internal');
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'retry_queue.jsonl');
  }

  add(action: Action, error: string): void {
    const items = this.readAll();

    // FIFO eviction if at cap
    while (items.length >= MAX_ITEMS) {
      items.shift();
    }

    const item: RetryItem = {
      id: randomUUID(),
      action,
      error,
      attempts: 1,
      created_at: new Date().toISOString(),
    };
    items.push(item);
    this.writeAll(items);
  }

  getAll(): RetryItem[] {
    return this.readAll();
  }

  remove(id: string): void {
    const items = this.readAll().filter((i) => i.id !== id);
    this.writeAll(items);
  }

  /** Remove items with attempts >= 3 or age > 1 hour. */
  cleanup(): number {
    const items = this.readAll();
    const now = Date.now();
    const kept = items.filter(
      (i) => i.attempts < MAX_ATTEMPTS && now - new Date(i.created_at).getTime() < MAX_AGE_MS,
    );
    const removed = items.length - kept.length;
    this.writeAll(kept);
    return removed;
  }

  private readAll(): RetryItem[] {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];
    const items: RetryItem[] = [];
    for (const line of content.split('\n')) {
      try {
        items.push(JSON.parse(line) as RetryItem);
      } catch {
        // skip malformed
      }
    }
    return items;
  }

  private writeAll(items: RetryItem[]): void {
    const content = items.map((i) => JSON.stringify(i)).join('\n');
    fs.writeFileSync(this.filePath, content ? content + '\n' : '', 'utf-8');
  }
}
