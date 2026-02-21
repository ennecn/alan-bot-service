/**
 * Diagnostic: Show compiled prompts for comparison test plan prompts.
 * Run: npx tsx tests/comparison-diagnostic.ts
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { importSTCardFromPng } from '../src/importers/st-card.js';
import { importSTWorldInfo } from '../src/importers/st-world.js';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { WorldEngine } from '../src/engines/world/index.js';
import { PromptCompiler } from '../src/compiler/index.js';
import type { EngineContext, MetroidMessage, AgentMode } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../src/db/schema.sql');
const TEST_DATA_DIR = resolve(__dirname, '../../sillytavern_test');

const config = {
  dataDir: ':memory:', dbPath: ':memory:',
  memory: { encodingSampleRate: 0.3, importanceThreshold: 0.4, fadeThreshold: 0.3, maxRetrievalResults: 5, defaultTimeWindowHours: 72 },
  llm: { apiKey: 'test', mainModel: 'test', lightModel: 'test', maxContextTokens: 200_000 },
  compiler: { responseReserveRatio: 0.3 },
};

function makeMsg(content: string): MetroidMessage {
  return { id: `msg-${Date.now()}`, content, author: { id: 'u1', name: 'User', isBot: false }, timestamp: new Date() };
}

// Setup
const db = new Database(':memory:');
db.exec(readFileSync(schemaPath, 'utf-8'));

const cardResult = importSTCardFromPng(resolve(TEST_DATA_DIR, 'main_rachel-29118321_spec_v2.png'), 'User');
const identity = new IdentityEngine(db);
const agent = identity.createAgent('Rachel', cardResult.card, 'classic');

const worldResult = importSTWorldInfo(
  resolve(TEST_DATA_DIR, 'main_genshin-impact-all-characters-and-locations-0a988c0432cd_sillytavern.json'),
  db, 'Rachel', 'User'
);

const world = new WorldEngine(db);
const compiler = new PromptCompiler(config);
compiler.registerEngine(identity);
compiler.registerEngine(world);

console.log(`\n=== Import Summary ===`);
console.log(`Character: ${cardResult.card.name}`);
console.log(`World entries imported: ${worldResult.entriesImported}`);
console.log(`World entries skipped: ${worldResult.entriesSkipped}`);

// DB stats
const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN position IS NOT NULL THEN 1 ELSE 0 END) as with_position,
    SUM(CASE WHEN selective_logic IS NOT NULL THEN 1 ELSE 0 END) as with_logic,
    SUM(CASE WHEN constant = 1 THEN 1 ELSE 0 END) as constants,
    SUM(CASE WHEN probability < 100 THEN 1 ELSE 0 END) as with_prob
  FROM world_entries WHERE enabled = 1
`).get() as any;

console.log(`\n=== DB Stats ===`);
console.log(`Total enabled: ${stats.total}`);
console.log(`With position: ${stats.with_position}`);
console.log(`With selective logic: ${stats.with_logic}`);
console.log(`Constants: ${stats.constants}`);
console.log(`With probability < 100: ${stats.with_prob}`);

// Position distribution
const positions = db.prepare(`
  SELECT position, COUNT(*) as c FROM world_entries WHERE enabled = 1 GROUP BY position
`).all() as any[];
console.log(`\nPosition distribution:`);
for (const p of positions) {
  console.log(`  ${p.position ?? '(none)'}: ${p.c}`);
}

// Test prompts
const testPrompts = [
  { name: 'Test 1.2 — Mondstadt', msg: "I've been playing Genshin Impact. Do you know anything about Mondstadt?" },
  { name: 'Test 1.3 — Venti', msg: "There's this character called Venti who's actually a god disguised as a bard." },
  { name: 'Test 1.4 — No trigger', msg: 'What made you want to become a pediatrician?' },
];

const BASE = 'You are a helpful roleplay assistant.';

for (const { name, msg } of testPrompts) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${name}`);
  console.log(`User: "${msg}"`);

  for (const mode of ['classic', 'enhanced'] as AgentMode[]) {
    const ctx: EngineContext = {
      agentId: agent.id, mode,
      message: makeMsg(msg),
      conversationHistory: [],
    };

    const worldFrags = await world.getPromptFragments(ctx);
    const compiled = await compiler.compile(BASE, ctx);

    console.log(`\n--- ${mode.toUpperCase()} MODE ---`);
    console.log(`World fragments: ${worldFrags.length}`);
    if (worldFrags.length > 0) {
      console.log(`Positions: ${worldFrags.map(f => f.position ?? 'none').join(', ')}`);
      console.log(`Total world tokens: ${worldFrags.reduce((s, f) => s + f.tokens, 0)}`);
    }
    console.log(`Compiled prompt length: ${compiled.length} chars (~${Math.ceil(compiled.length/3)} tokens)`);
    console.log(`\nFirst 500 chars of compiled prompt:`);
    console.log(compiled.slice(0, 500));
    console.log('...');
  }
}

db.close();
