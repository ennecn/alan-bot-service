import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import type Database from 'better-sqlite3';
import { importSTCardFromPng, importSTCardFromJson } from '../src/importers/st-card.js';
import { importSTWorldInfo, importSTCharacterBook } from '../src/importers/st-world.js';
import { createTestDb } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths to actual ST test files
const ST_BASE = 'D:\\sillytavern\\SillyTavern-Launcher\\SillyTavern\\data\\default-user';
const CHAR_PNG = resolve(ST_BASE, 'characters', '沉迹.png');
const WORLD_JSON = resolve(ST_BASE, 'worlds', '修真玄幻.json');

const hasST = existsSync(CHAR_PNG);

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe('ST Card V2 Importer', () => {
  it.skipIf(!hasST)('should import character card from PNG', () => {
    const result = importSTCardFromPng(CHAR_PNG);

    expect(result.card.name).toBe('沉迹');
    expect(result.card.description.length).toBeGreaterThan(100);
    expect(result.card.personality).toBeDefined();
    expect(result.card.soul?.immutableValues).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasST)('should extract embedded character book', () => {
    const result = importSTCardFromPng(CHAR_PNG);

    expect(result.characterBook).toBeDefined();
    expect(result.characterBook!.entries.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasST)('should detect linked world book', () => {
    const result = importSTCardFromPng(CHAR_PNG);
    expect(result.linkedWorldName).toBe('修真玄幻');
  });

  it.skipIf(!hasST)('should replace {{char}} placeholders', () => {
    const result = importSTCardFromPng(CHAR_PNG, '测试用户');
    // Description should not contain raw {{char}} anymore
    expect(result.card.description).not.toContain('{{char}}');
  });

  it('should import from JSON format', () => {
    const jsonCard = resolve(__dirname, '..', 'cards', 'xiaolin.json');
    const result = importSTCardFromJson(jsonCard);

    expect(result.card.name).toBe('小凛');
    expect(result.card.personality).toContain('活泼');
  });
});

describe('ST World Info Importer', () => {
  it.skipIf(!hasST)('should import world info entries', () => {
    const result = importSTWorldInfo(WORLD_JSON, db, '沉迹');

    expect(result.entriesImported).toBeGreaterThan(0);

    // Verify entries in database
    const count = db.prepare('SELECT COUNT(*) as c FROM world_entries').get() as any;
    expect(count.c).toBe(result.entriesImported);
  });

  it.skipIf(!hasST)('should import embedded character book', () => {
    const cardResult = importSTCardFromPng(CHAR_PNG);
    if (!cardResult.characterBook) return;

    const result = importSTCharacterBook(cardResult.characterBook, db, '沉迹');
    expect(result.entriesImported).toBeGreaterThan(0);
  });

  it.skipIf(!hasST)('should replace {{char}} in world entries', () => {
    importSTWorldInfo(WORLD_JSON, db, '沉迹');

    const entries = db.prepare('SELECT content FROM world_entries').all() as any[];
    for (const entry of entries) {
      expect(entry.content).not.toContain('{{char}}');
    }
  });
});
