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
  position: number;        // 0=before_char, 1=after_char, 2=before_an, 3=after_an, 4=at_depth
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

const SELECTIVE_LOGIC_MAP: Record<number, string> = {
  0: 'AND_ANY',
  1: 'NOT_ALL',
  2: 'NOT_ANY',
  3: 'AND_ALL',
};

const POSITION_MAP: Record<number, string> = {
  0: 'before_char',
  1: 'after_char',
  2: 'before_an',
  3: 'after_an',
  4: 'at_depth',
};

/**
 * Import a SillyTavern World Info JSON file into Metroid's world_entries table.
 * All ST fields are preserved for classic mode compatibility.
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
    INSERT INTO world_entries (
      id, keywords, secondary_keywords, content, priority,
      scope, scope_target, enabled,
      selective_logic, position, depth, probability, constant
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: STWorldEntry[]) => {
    for (const entry of items) {
      if (entry.disable) { skipped++; continue; }
      if (!entry.content?.trim()) { skipped++; continue; }

      // Replace ST placeholders
      let content = entry.content;
      if (charName) content = content.replace(/\{\{char\}\}/gi, charName);
      if (userName) content = content.replace(/\{\{user\}\}/gi, userName);

      // Map ST priority: constant entries get high priority, others use order
      const priority = entry.constant ? 9 : Math.min(9, Math.max(1, Math.round(entry.order / 20)));

      // Map selective logic and position
      const selectiveLogic = entry.selective ? (SELECTIVE_LOGIC_MAP[entry.selectiveLogic] ?? null) : null;
      const position = POSITION_MAP[entry.position] ?? null;
      const secondaryKws = entry.selective && entry.keysecondary?.length
        ? entry.keysecondary.join(',') : null;

      insert.run(
        randomUUID(),
        entry.key.join(','),
        secondaryKws,
        content,
        priority,
        'all',
        null,
        1,
        selectiveLogic,
        position,
        entry.depth ?? null,
        entry.useProbability ? entry.probability : 100,
        entry.constant ? 1 : 0,
      );
      imported++;
    }
  });

  insertMany(entries);

  return { entriesImported: imported, entriesSkipped: skipped, warnings };
}
