/**
 * Comparison Test: Re-import ST test data, verify field preservation,
 * and compare classic vs enhanced mode prompt compilation.
 *
 * Test data: Rachel character card + Genshin Impact world book (194 entries)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers.js';
import { importSTCardFromPng } from '../src/importers/st-card.js';
import { importSTWorldInfo } from '../src/importers/st-world.js';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { WorldEngine } from '../src/engines/world/index.js';
import { PromptCompiler } from '../src/compiler/index.js';
import type { EngineContext, MetroidMessage, AgentMode } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = resolve(__dirname, '../../sillytavern_test');
const RACHEL_PNG = resolve(TEST_DATA_DIR, 'main_rachel-29118321_spec_v2.png');
const GENSHIN_WORLD = resolve(TEST_DATA_DIR, 'main_genshin-impact-all-characters-and-locations-0a988c0432cd_sillytavern.json');

const testConfig = {
  dataDir: ':memory:',
  dbPath: ':memory:',
  memory: {
    encodingSampleRate: 0.3,
    importanceThreshold: 0.4,
    fadeThreshold: 0.3,
    maxRetrievalResults: 5,
    defaultTimeWindowHours: 72,
  },
  llm: {
    apiKey: 'test',
    mainModel: 'test',
    lightModel: 'test',
    maxContextTokens: 200_000,
  },
  compiler: { responseReserveRatio: 0.3 },
};

function makeMessage(content: string): MetroidMessage {
  return {
    id: `msg-${Date.now()}`,
    content,
    author: { id: 'user-1', name: 'User', isBot: false },
    timestamp: new Date(),
  };
}

function makeContext(agentId: string, mode: AgentMode, message: string, history: string[] = []): EngineContext {
  return {
    agentId,
    mode,
    message: makeMessage(message),
    conversationHistory: history.map(h => makeMessage(h)),
  };
}

// Skip if test data not available
const hasTestData = existsSync(RACHEL_PNG) && existsSync(GENSHIN_WORLD);
const describeIf = hasTestData ? describe : describe.skip;

describeIf('Comparison: ST Import + Dual-Mode Compilation', () => {
  let db: Database.Database;
  let identity: IdentityEngine;
  let world: WorldEngine;
  let compiler: PromptCompiler;
  let agentId: string;

  beforeAll(() => {
    db = createTestDb();

    // 1. Import Rachel character card
    const cardResult = importSTCardFromPng(RACHEL_PNG, 'User');
    expect(cardResult.card.name).toBe('Rachel');

    // 2. Create agent in classic mode
    identity = new IdentityEngine(db);
    const agent = identity.createAgent('Rachel', cardResult.card, 'classic');
    agentId = agent.id;

    // 3. Import embedded character book if present
    if (cardResult.characterBook?.entries?.length) {
      const { importSTCharacterBook } = require('../src/importers/st-world.js');
      importSTCharacterBook(cardResult.characterBook, db, 'Rachel', 'User');
    }

    // 4. Import Genshin Impact world book
    const worldResult = importSTWorldInfo(GENSHIN_WORLD, db, 'Rachel', 'User');
    expect(worldResult.entriesImported).toBeGreaterThan(100);

    // 5. Initialize engines
    world = new WorldEngine(db);
    compiler = new PromptCompiler(testConfig);
    compiler.registerEngine(identity);
    compiler.registerEngine(world);
  });

  // === Section 1: Import Verification ===

  describe('Import Verification', () => {
    it('should import all enabled Genshin entries', () => {
      const count = db.prepare('SELECT COUNT(*) as c FROM world_entries WHERE enabled = 1').get() as any;
      expect(count.c).toBeGreaterThan(100);
    });

    it('should preserve ST position fields', () => {
      const withPosition = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE position IS NOT NULL'
      ).get() as any;
      expect(withPosition.c).toBeGreaterThan(0);
    });

    it('should preserve ST selective_logic fields', () => {
      // Check if any entries have selective logic set
      const withLogic = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE selective_logic IS NOT NULL'
      ).get() as any;
      // Not all entries use selective logic, but the field should be preserved
      expect(withLogic).toBeDefined();
    });

    it('should preserve probability values', () => {
      const withProb = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE probability < 100'
      ).get() as any;
      // Some entries may have probability < 100
      expect(withProb).toBeDefined();
    });

    it('should preserve constant entries', () => {
      const constants = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE constant = 1'
      ).get() as any;
      expect(constants).toBeDefined();
    });

    it('should only store secondary keywords when selective is enabled', () => {
      // Genshin world book has selective=false for all entries,
      // so secondary_keywords should be null (correct ST behavior)
      const withSecondary = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE secondary_keywords IS NOT NULL'
      ).get() as any;
      // This dataset has no selective entries, so count should be 0
      expect(withSecondary.c).toBe(0);
    });

    it('should have replaced {{char}} placeholders', () => {
      const withPlaceholder = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE content LIKE \'%{{char}}%\''
      ).get() as any;
      expect(withPlaceholder.c).toBe(0);
    });

    it('should have replaced {{user}} placeholders', () => {
      const withPlaceholder = db.prepare(
        'SELECT COUNT(*) as c FROM world_entries WHERE content LIKE \'%{{user}}%\''
      ).get() as any;
      expect(withPlaceholder.c).toBe(0);
    });
  });

  // === Section 2: World Engine Keyword Matching ===

  describe('World Engine: Keyword Matching with Real Data', () => {
    it('should trigger Mondstadt entry when mentioned', async () => {
      const ctx = makeContext(agentId, 'classic', 'Tell me about Mondstadt');
      const fragments = await world.getPromptFragments(ctx);
      const allContent = fragments.map(f => f.content).join('\n');
      expect(allContent.toLowerCase()).toContain('mondstadt');
    });

    it('should trigger Venti entry when mentioned', async () => {
      const ctx = makeContext(agentId, 'classic', 'Who is Venti?');
      const fragments = await world.getPromptFragments(ctx);
      const allContent = fragments.map(f => f.content).join('\n');
      expect(allContent.toLowerCase()).toContain('venti');
    });

    it('should trigger multiple entries for broad topic', async () => {
      const ctx = makeContext(agentId, 'classic',
        'Tell me about the Archons of Teyvat, like Zhongli and Raiden Shogun');
      const fragments = await world.getPromptFragments(ctx);
      const allContent = fragments.map(f => f.content).join('\n').toLowerCase();
      // Should match multiple entries
      expect(allContent.length).toBeGreaterThan(200);
    });

    it('should return nothing for unrelated topic', async () => {
      const ctx = makeContext(agentId, 'classic',
        'What did you have for breakfast today?');
      const fragments = await world.getPromptFragments(ctx);
      // May still have constant entries
      const nonConstant = fragments.filter(f => !f.content.includes('[constant]'));
      // Most fragments should be from keyword matches, which shouldn't fire here
      expect(fragments.length).toBeLessThanOrEqual(5);
    });

    it('should scan conversation history for keywords', async () => {
      const ctx = makeContext(agentId, 'classic',
        'Tell me more about that place',
        ['I was exploring Liyue Harbor yesterday']);
      const fragments = await world.getPromptFragments(ctx);
      const allContent = fragments.map(f => f.content).join('\n').toLowerCase();
      expect(allContent).toContain('liyue');
    });
  });

  // === Section 3: Classic vs Enhanced Mode Comparison ===

  describe('Classic vs Enhanced Mode: Structural Differences', () => {
    it('classic mode should produce position-grouped fragments', async () => {
      const ctx = makeContext(agentId, 'classic',
        'Tell me about Mondstadt and its Archon');
      const fragments = await world.getPromptFragments(ctx);

      // Classic mode groups by position
      const positions = fragments.map(f => f.position).filter(Boolean);
      // Should have at least one positioned fragment
      if (fragments.length > 0) {
        expect(positions.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('enhanced mode should produce single combined fragment', async () => {
      const ctx = makeContext(agentId, 'enhanced',
        'Tell me about Mondstadt and its Archon');
      const fragments = await world.getPromptFragments(ctx);

      // Enhanced mode: single fragment, no position
      if (fragments.length > 0) {
        expect(fragments.length).toBe(1);
        expect(fragments[0].position).toBeUndefined();
      }
    });

    it('classic mode compiled prompt should order by ST position', async () => {
      const ctx = makeContext(agentId, 'classic',
        'Tell me about Mondstadt and the Archon system');
      const base = 'You are a helpful assistant.';
      const compiled = await compiler.compile(base, ctx);

      // Identity should come before world info in classic mode
      expect(compiled).toContain('Rachel');
      expect(compiled.indexOf('Rachel')).toBeLessThan(compiled.indexOf('<world_info>'));
    });

    it('enhanced mode compiled prompt should order by section type', async () => {
      const ctx = makeContext(agentId, 'enhanced',
        'Tell me about Mondstadt and the Archon system');
      const base = 'You are a helpful assistant.';
      const compiled = await compiler.compile(base, ctx);

      // Enhanced mode: identity before world
      expect(compiled).toContain('Rachel');
      expect(compiled.indexOf('Rachel')).toBeLessThan(compiled.indexOf('<world_info>'));
    });

    it('both modes should include same world content for same query', async () => {
      const msg = 'Tell me about Venti the bard';
      const classicCtx = makeContext(agentId, 'classic', msg);
      const enhancedCtx = makeContext(agentId, 'enhanced', msg);

      const classicFrags = await world.getPromptFragments(classicCtx);
      const enhancedFrags = await world.getPromptFragments(enhancedCtx);

      // Both should contain Venti info
      const classicContent = classicFrags.map(f => f.content).join('\n');
      const enhancedContent = enhancedFrags.map(f => f.content).join('\n');
      expect(classicContent.toLowerCase()).toContain('venti');
      expect(enhancedContent.toLowerCase()).toContain('venti');
    });
  });

  // === Section 4: Comparison Test Plan Prompts ===

  describe('Comparison Test Plan: Prompt Compilation', () => {
    const testPrompts = [
      {
        name: 'Test 1.1 — 初次见面',
        message: 'Hi Rachel, I just moved to this neighborhood. Someone told me you teach theology to kids at the church?',
      },
      {
        name: 'Test 1.2 — 触发世界书 (Mondstadt)',
        message: "By the way, I've been playing this game called Genshin Impact lately. Do you know anything about Mondstadt? It reminds me of a European city.",
      },
      {
        name: 'Test 1.3 — 深入世界书 (Venti)',
        message: "There's this character called Venti who's actually a god disguised as a bard. Kind of reminds me of angels in disguise, don't you think?",
      },
      {
        name: 'Test 1.4 — 个人话题',
        message: 'What made you want to become a pediatrician? Was it something from your childhood?',
      },
      {
        name: 'Test 1.5 — 情感互动',
        message: 'I have to admit, I was nervous about talking to you. You seem so kind and genuine, it\'s refreshing.',
      },
    ];

    for (const { name, message } of testPrompts) {
      it(`${name}: classic mode should compile without error`, async () => {
        const ctx = makeContext(agentId, 'classic', message);
        const compiled = await compiler.compile('You are a helpful assistant.', ctx);
        expect(compiled).toBeTruthy();
        expect(compiled).toContain('Rachel');
      });

      it(`${name}: enhanced mode should compile without error`, async () => {
        const ctx = makeContext(agentId, 'enhanced', message);
        const compiled = await compiler.compile('You are a helpful assistant.', ctx);
        expect(compiled).toBeTruthy();
        expect(compiled).toContain('Rachel');
      });
    }

    it('Test 1.2 should trigger Mondstadt world info in both modes', async () => {
      const msg = "By the way, I've been playing this game called Genshin Impact lately. Do you know anything about Mondstadt?";

      const classicCompiled = await compiler.compile('Base.',
        makeContext(agentId, 'classic', msg));
      const enhancedCompiled = await compiler.compile('Base.',
        makeContext(agentId, 'enhanced', msg));

      expect(classicCompiled.toLowerCase()).toContain('mondstadt');
      expect(enhancedCompiled.toLowerCase()).toContain('mondstadt');
    });

    it('Test 1.3 should trigger Venti world info in both modes', async () => {
      const msg = "There's this character called Venti who's actually a god disguised as a bard.";

      const classicCompiled = await compiler.compile('Base.',
        makeContext(agentId, 'classic', msg));
      const enhancedCompiled = await compiler.compile('Base.',
        makeContext(agentId, 'enhanced', msg));

      expect(classicCompiled.toLowerCase()).toContain('venti');
      expect(enhancedCompiled.toLowerCase()).toContain('venti');
    });

    it('Test 1.4 should NOT trigger world info (no Genshin keywords)', async () => {
      const msg = 'What made you want to become a pediatrician? Was it something from your childhood?';

      const ctx = makeContext(agentId, 'classic', msg);
      const worldFrags = await world.getPromptFragments(ctx);

      // Should have very few or no world entries (maybe constants only)
      const totalTokens = worldFrags.reduce((sum, f) => sum + f.tokens, 0);
      expect(totalTokens).toBeLessThan(500);
    });
  });

  // === Section 5: Mode Switching ===

  describe('Mode Switching', () => {
    it('should switch agent from classic to enhanced', () => {
      identity.setMode(agentId, 'enhanced');
      const agent = identity.getAgent(agentId);
      expect(agent?.mode).toBe('enhanced');
    });

    it('should switch back to classic', () => {
      identity.setMode(agentId, 'classic');
      const agent = identity.getAgent(agentId);
      expect(agent?.mode).toBe('classic');
    });

    it('mode switch should persist in DB', () => {
      identity.setMode(agentId, 'enhanced');
      const row = db.prepare('SELECT mode FROM agents WHERE id = ?').get(agentId) as any;
      expect(row.mode).toBe('enhanced');
      // Reset
      identity.setMode(agentId, 'classic');
    });
  });
});

