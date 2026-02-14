import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { STCharacterBook, STBookEntry } from './st-card.js';

/** Raw ST World Info file format */
interface STWorldInfo {
  entries: Record<string, STWorldEntry>;
}

interface STWorldEntry {
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;  // 0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL
  order: number;
  position: number;        // 0=before_char, 3=after_char
  disable: boolean;
  depth: number;
  probability: number;
  useProbability: boolean;
  uid: number;
  displayIndex: number;
  extensions: Record<string, unknown>;
}

export interface WorldImportResult {
  entriesImported: number;
  entriesSkipped: number;
  warnings: string[];
}

/**
 * Import a SillyTavern World Info JSON file into Metroid's world_entries table.
 */
export function importSTWorldInfo(
  jsonPath: string,
  db: Database.Database,
  charName?: string,
  userName?: string,
): WorldImportResult {
  const raw: STWorldInfo = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  return importEntries(Object.values(raw.entries), db, charName, userName);
}

/**
 * Import entries from an embedded ST Character Book.
 */
export function importSTCharacterBook(
  book: STCharacterBook,
  db: Database.Database,
  charName?: string,
  userName?: string,
): WorldImportResult {
  // Convert STBookEntry to STWorldEntry-like format
  const entries: STWorldEntry[] = book.entries.map(e => ({
    key: e.keys,
    keysecondary: e.secondary_keys,
    comment: e.comment,
    content: e.content,
    constant: e.constant,
    selective: e.selective,
    selectiveLogic: 0,
    order: e.insertion_order,
    position: e.position === 'before_char' ? 0 : 3,
    disable: !e.enabled,
    depth: 4,
    probability: 100,
    useProbability: false,
    uid: e.id,
    displayIndex: e.id,
    extensions: e.extensions || {},
  }));

  return importEntries(entries, db, charName, userName);
}

function importEntries(
  entries: STWorldEntry[],
  db: Database.Database,
  charName?: string,
  userName?: string,
): WorldImportResult {
  const warnings: string[] = [];
  let imported = 0;
  let skipped = 0;

  const insert = db.prepare(`
    INSERT INTO world_entries (id, keywords, content, priority, scope, scope_target, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: STWorldEntry[]) => {
    for (const entry of items) {
      // Skip disabled entries
      if (entry.disable) {
        skipped++;
        continue;
      }

      // Skip empty content
      if (!entry.content?.trim()) {
        skipped++;
        continue;
      }

      // Combine primary and secondary keywords
      const allKeywords = [...entry.key];
      if (entry.selective && entry.keysecondary?.length) {
        allKeywords.push(...entry.keysecondary);
      }

      // Replace ST placeholders
      let content = entry.content;
      if (charName) content = content.replace(/\{\{char\}\}/gi, charName);
      if (userName) content = content.replace(/\{\{user\}\}/gi, userName);

      // Map ST priority: constant entries get high priority, others use order
      const priority = entry.constant ? 9 : Math.min(9, Math.max(1, Math.round(entry.order / 20)));

      // Note unsupported features
      if (entry.selective && entry.selectiveLogic !== 0) {
        warnings.push(
          `条目 "${allKeywords[0] || entry.uid}": 使用了高级选择逻辑(${entry.selectiveLogic})，` +
          `Metroid 当前仅支持 OR 匹配`
        );
      }
      if (entry.useProbability && entry.probability < 100) {
        warnings.push(
          `条目 "${allKeywords[0] || entry.uid}": 概率触发(${entry.probability}%)暂不支持，已设为始终启用`
        );
      }

      insert.run(
        randomUUID(),
        allKeywords.join(','),
        content,
        priority,
        'all',
        null,
        1,
      );
      imported++;
    }
  });

  insertMany(entries);

  return { entriesImported: imported, entriesSkipped: skipped, warnings };
}
