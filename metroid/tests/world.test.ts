import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { WorldEngine } from '../src/engines/world/index.js';
import type { EngineContext, AgentMode } from '../src/types.js';
import { createTestDb, createTestAgent } from './helpers.js';
import { randomUUID } from 'crypto';

let db: Database.Database;
let world: WorldEngine;
let agentId: string;

interface EntryOpts {
  keywords: string;
  content: string;
  priority?: number;
  secondaryKeywords?: string;
  selectiveLogic?: string;
  position?: string;
  depth?: number;
  probability?: number;
  constant?: number;
}

function insertEntry(db: Database.Database, opts: EntryOpts) {
  db.prepare(`
    INSERT INTO world_entries (id, keywords, secondary_keywords, content, priority,
      scope, enabled, selective_logic, position, depth, probability, constant)
    VALUES (?, ?, ?, ?, ?, 'all', 1, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), opts.keywords, opts.secondaryKeywords ?? null,
    opts.content, opts.priority ?? 5,
    opts.selectiveLogic ?? null, opts.position ?? null,
    opts.depth ?? null, opts.probability ?? 100, opts.constant ?? 0,
  );
}

// Shorthand for simple entries (backward compat)
function insertWorldEntry(db: Database.Database, keywords: string, content: string, priority = 5) {
  insertEntry(db, { keywords, content, priority });
}

function mockContext(text: string, mode: AgentMode = 'enhanced', history: string[] = []): EngineContext {
  return {
    agentId: 'test',
    mode,
    message: {
      id: 'msg-1', channel: 'web-im',
      author: { id: 'user-1', name: 'User', isBot: false },
      content: text, timestamp: Date.now(),
    },
    conversationHistory: history.map((h, i) => ({
      id: `msg-h${i}`, channel: 'web-im' as const,
      author: { id: 'user-1', name: 'User', isBot: false },
      content: h, timestamp: Date.now() - (history.length - i) * 1000,
    })),
  };
}

beforeEach(() => {
  db = createTestDb();
  agentId = createTestAgent(db);
});

describe('WorldEngine — Enhanced mode', () => {
  it('should trigger entries by keyword match', async () => {
    insertWorldEntry(db, 'Mondstadt,风之城', 'Mondstadt is the City of Freedom...');
    insertWorldEntry(db, 'Liyue,璃月', 'Liyue is a prosperous harbor...');
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('Tell me about Mondstadt'));
    expect(fragments).toHaveLength(1);
    expect(fragments[0].content).toContain('Mondstadt');
    expect(fragments[0].content).not.toContain('Liyue');
  });

  it('should match multiple entries', async () => {
    insertWorldEntry(db, 'Venti,温迪', 'Venti is the Anemo Archon...');
    insertWorldEntry(db, 'Mondstadt,Venti', 'Mondstadt worships Barbatos...');
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('Venti plays his lyre in Mondstadt'));
    expect(fragments).toHaveLength(1);
    expect(fragments[0].content).toContain('Venti');
    expect(fragments[0].content).toContain('Mondstadt');
  });

  it('should match case-insensitively', async () => {
    insertWorldEntry(db, 'Zhongli,钟离', 'Zhongli is the Geo Archon...');
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('I met ZHONGLI at the harbor'));
    expect(fragments).toHaveLength(1);
    expect(fragments[0].content).toContain('Zhongli');
  });

  it('should scan conversation history', async () => {
    insertWorldEntry(db, 'Inazuma,稻妻', 'Inazuma is the nation of Eternity...');
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(
      mockContext('What happened next?', 'enhanced', ['We arrived at Inazuma yesterday'])
    );
    expect(fragments).toHaveLength(1);
    expect(fragments[0].content).toContain('Inazuma');
  });

  it('should return empty when no match', async () => {
    insertWorldEntry(db, 'Sumeru,须弥', 'Sumeru is the nation of Wisdom...');
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('Hello, how are you?'));
    expect(fragments).toHaveLength(0);
  });

  it('should sort by priority and cap at 15', async () => {
    for (let i = 0; i < 20; i++) {
      insertWorldEntry(db, 'test', `Entry number ${i}`, i);
    }
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('This is a test'));
    expect(fragments).toHaveLength(1);
    expect(fragments[0].content).toContain('Entry number 19');
    expect(fragments[0].content).toContain('Entry number 5');
    expect(fragments[0].content).not.toContain('Entry number 4');
  });

  it('should return single fragment without position in enhanced mode', async () => {
    insertEntry(db, { keywords: 'dragon', content: 'A dragon', position: 'before_char' });
    insertEntry(db, { keywords: 'dragon', content: 'Another dragon', position: 'after_char' });
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('dragon'));
    expect(fragments).toHaveLength(1); // enhanced mode: single combined fragment
    expect(fragments[0].position).toBeUndefined();
  });
});

describe('WorldEngine — Classic mode', () => {
  it('should group fragments by ST position', async () => {
    insertEntry(db, { keywords: 'dragon', content: 'Before char dragon', position: 'before_char' });
    insertEntry(db, { keywords: 'dragon', content: 'After char dragon', position: 'after_char' });
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('dragon', 'classic'));
    expect(fragments.length).toBeGreaterThanOrEqual(2);
    const positions = fragments.map(f => f.position);
    expect(positions).toContain('before_char');
    expect(positions).toContain('after_char');
  });

  it('should apply AND_ANY selective logic', async () => {
    insertEntry(db, {
      keywords: 'dragon',
      secondaryKeywords: 'fire,ice',
      selectiveLogic: 'AND_ANY',
      content: 'A fire or ice dragon',
    });
    world = new WorldEngine(db);

    // Has secondary keyword "fire" → should match
    const match = await world.getPromptFragments(mockContext('dragon breathes fire', 'classic'));
    expect(match).toHaveLength(1);

    // No secondary keyword → should NOT match
    const noMatch = await world.getPromptFragments(mockContext('dragon flies away', 'classic'));
    expect(noMatch).toHaveLength(0);
  });

  it('should apply NOT_ANY selective logic', async () => {
    insertEntry(db, {
      keywords: 'dragon',
      secondaryKeywords: 'evil,dark',
      selectiveLogic: 'NOT_ANY',
      content: 'A good dragon',
    });
    world = new WorldEngine(db);

    // No secondary keywords present → should match
    const match = await world.getPromptFragments(mockContext('dragon helps the village', 'classic'));
    expect(match).toHaveLength(1);

    // Has secondary keyword "evil" → should NOT match
    const noMatch = await world.getPromptFragments(mockContext('evil dragon attacks', 'classic'));
    expect(noMatch).toHaveLength(0);
  });

  it('should apply AND_ALL selective logic', async () => {
    insertEntry(db, {
      keywords: 'dragon',
      secondaryKeywords: 'fire,ancient',
      selectiveLogic: 'AND_ALL',
      content: 'An ancient fire dragon',
    });
    world = new WorldEngine(db);

    // Both secondary keywords → match
    const match = await world.getPromptFragments(mockContext('ancient fire dragon', 'classic'));
    expect(match).toHaveLength(1);

    // Only one secondary keyword → no match
    const noMatch = await world.getPromptFragments(mockContext('fire dragon', 'classic'));
    expect(noMatch).toHaveLength(0);
  });

  it('should apply NOT_ALL selective logic', async () => {
    insertEntry(db, {
      keywords: 'dragon',
      secondaryKeywords: 'fire,ice',
      selectiveLogic: 'NOT_ALL',
      content: 'A dragon that is not both fire and ice',
    });
    world = new WorldEngine(db);

    // Only one secondary keyword → match (not ALL present)
    const match = await world.getPromptFragments(mockContext('fire dragon', 'classic'));
    expect(match).toHaveLength(1);

    // Both secondary keywords → no match (ALL present)
    const noMatch = await world.getPromptFragments(mockContext('fire and ice dragon', 'classic'));
    expect(noMatch).toHaveLength(0);
  });

  it('should always trigger constant entries', async () => {
    insertEntry(db, { keywords: 'zzz_never_match', content: 'Always present lore', constant: 1 });
    world = new WorldEngine(db);

    const fragments = await world.getPromptFragments(mockContext('hello world', 'classic'));
    expect(fragments).toHaveLength(1);
    expect(fragments[0].content).toContain('Always present lore');
  });

  it('should ignore selective logic in enhanced mode', async () => {
    insertEntry(db, {
      keywords: 'dragon',
      secondaryKeywords: 'fire,ice',
      selectiveLogic: 'AND_ANY',
      content: 'A selective dragon',
    });
    world = new WorldEngine(db);

    // Enhanced mode: selective logic ignored, primary keyword match is enough
    const fragments = await world.getPromptFragments(mockContext('dragon flies away', 'enhanced'));
    expect(fragments).toHaveLength(1);
  });
});
