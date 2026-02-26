/**
 * Card Import Tests — covers card-data.json persistence, reimport preservation,
 * schema validation, and Import LLM integration (mocked).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { importCard } from '../index.js';
import { validateSchemaVersion, CURRENT_SCHEMA_VERSION } from '../schema-version.js';
import type { CardData } from '../mapper.js';
import type { STCardV2 } from '../types.js';

let tmpDir: string;
let cardPath: string;

const sampleCard: STCardV2 = {
  name: 'TestChar',
  description: '一个活泼可爱的测试角色',
  personality: 'Cheerful and curious',
  scenario: 'A quiet afternoon',
  first_mes: 'Hello!',
  mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello!',
  alternate_greetings: ['Hey there!'],
  system_prompt: 'You are TestChar, a cheerful character.',
  post_history_instructions: 'Always stay in character.',
  character_book: {
    entries: [
      {
        keys: ['cat', 'cats'],
        content: 'TestChar loves cats.',
        enabled: true,
      },
    ],
  },
  extensions: {
    behavioral_engine: {
      schema_version: '1.0',
      emotion_baseline: { joy: 0.7, trust: 0.6 },
    },
  },
};

function writeCardJson(dir: string, card: STCardV2): string {
  const p = path.join(dir, 'card.json');
  fs.writeFileSync(p, JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card }), 'utf-8');
  return p;
}

describe('Card Import: card-data.json persistence', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-card-test-'));
    const workDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });
    cardPath = writeCardJson(tmpDir, sampleCard);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes card-data.json with correct fields', async () => {
    const workDir = path.join(tmpDir, 'workspace');
    await importCard(cardPath, workDir);

    const cardDataPath = path.join(workDir, 'internal', 'card-data.json');
    expect(fs.existsSync(cardDataPath)).toBe(true);

    const cardData: CardData = JSON.parse(fs.readFileSync(cardDataPath, 'utf-8'));
    expect(cardData.character_name).toBe('TestChar');
    expect(cardData.system_prompt).toBe('You are TestChar, a cheerful character.');
    expect(cardData.post_history_instructions).toBe('Always stay in character.');
    expect(cardData.mes_example).toContain('{{char}}');
    expect(cardData.detected_language).toBe('zh');
  });

  it('constructs system_prompt from description+personality+scenario when system_prompt is empty', async () => {
    const cardNoPrompt = { ...sampleCard, system_prompt: '' };
    const noPromptPath = writeCardJson(tmpDir, cardNoPrompt);
    const workDir = path.join(tmpDir, 'workspace');

    // Need a fresh workspace dir
    const workDir2 = path.join(tmpDir, 'workspace2');
    fs.mkdirSync(workDir2, { recursive: true });
    await importCard(noPromptPath, workDir2);

    const cardData: CardData = JSON.parse(
      fs.readFileSync(path.join(workDir2, 'internal', 'card-data.json'), 'utf-8'),
    );

    expect(cardData.system_prompt).toContain('活泼可爱');
    expect(cardData.system_prompt).toContain('Cheerful and curious');
    expect(cardData.system_prompt).toContain('A quiet afternoon');
  });

  it('detects English when description is English', async () => {
    const enCard = { ...sampleCard, description: 'A cheerful girl who loves adventure.' };
    const enPath = writeCardJson(tmpDir, enCard);
    const workDir = path.join(tmpDir, 'workspace-en');
    fs.mkdirSync(workDir, { recursive: true });

    await importCard(enPath, workDir);

    const cardData: CardData = JSON.parse(
      fs.readFileSync(path.join(workDir, 'internal', 'card-data.json'), 'utf-8'),
    );
    expect(cardData.detected_language).toBe('en');
  });
});

describe('Card Import: reimport preserves MEMORY.md', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-reimport-test-'));
    cardPath = writeCardJson(tmpDir, sampleCard);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves MEMORY.md and emotion_state.md on reimport', async () => {
    const workDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    // First import
    await importCard(cardPath, workDir);

    // Write MEMORY.md and emotion_state.md
    const memoryContent = '# Memory\n\nUser likes cats.';
    const emotionContent = '# Emotion State\n\njoy: 0.8';
    fs.writeFileSync(path.join(workDir, 'MEMORY.md'), memoryContent, 'utf-8');
    fs.writeFileSync(path.join(workDir, 'emotion_state.md'), emotionContent, 'utf-8');

    // Reimport
    await importCard(cardPath, workDir, { reimport: true });

    // Check preserved
    expect(fs.readFileSync(path.join(workDir, 'MEMORY.md'), 'utf-8')).toBe(memoryContent);
    expect(fs.readFileSync(path.join(workDir, 'emotion_state.md'), 'utf-8')).toBe(emotionContent);
  });

  it('overwrites IDENTITY.md on reimport', async () => {
    const workDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    // First import
    await importCard(cardPath, workDir);

    // Modify IDENTITY.md manually
    fs.writeFileSync(path.join(workDir, 'IDENTITY.md'), 'modified', 'utf-8');

    // Reimport
    await importCard(cardPath, workDir, { reimport: true });

    // IDENTITY.md should be regenerated from card data
    const identity = fs.readFileSync(path.join(workDir, 'IDENTITY.md'), 'utf-8');
    expect(identity).toContain('TestChar');
    expect(identity).not.toBe('modified');
  });
});

describe('Schema Version Validation', () => {
  it('returns CURRENT_SCHEMA_VERSION for missing version', () => {
    expect(validateSchemaVersion(undefined)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('returns CURRENT_SCHEMA_VERSION for empty string', () => {
    expect(validateSchemaVersion('')).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('accepts compatible version 1.0', () => {
    expect(validateSchemaVersion('1.0')).toBe('1.0');
  });

  it('accepts minor version diff 1.1', () => {
    expect(validateSchemaVersion('1.1')).toBe('1.1');
  });

  it('throws for incompatible major version 2.0', () => {
    expect(() => validateSchemaVersion('2.0')).toThrow('Incompatible card schema version');
    expect(() => validateSchemaVersion('2.0')).toThrow('Major version 2');
  });

  it('throws for major version 3.5', () => {
    expect(() => validateSchemaVersion('3.5')).toThrow('Incompatible');
  });

  it('integrates into importCard flow', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-schema-test-'));
    const workDir = path.join(dir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    const badCard: STCardV2 = {
      ...sampleCard,
      extensions: {
        behavioral_engine: {
          schema_version: '2.0',
        },
      },
    };
    const badPath = path.join(dir, 'bad-card.json');
    fs.writeFileSync(badPath, JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: badCard }), 'utf-8');

    await expect(importCard(badPath, workDir)).rejects.toThrow('Incompatible');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Card Import: WI entries', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-wi-test-'));
    cardPath = writeCardJson(tmpDir, sampleCard);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports WI entries to SQLite', async () => {
    const workDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    const result = await importCard(cardPath, workDir);
    expect(result.wi_count).toBe(1);
  });

  it('writes greetings.json', async () => {
    const workDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    await importCard(cardPath, workDir);

    const greetings = JSON.parse(
      fs.readFileSync(path.join(workDir, 'internal', 'greetings.json'), 'utf-8'),
    );
    expect(greetings).toEqual(['Hello!', 'Hey there!']);
  });
});

describe('Import LLM (mocked)', () => {
  it('callImportLLM returns null when card-data.json is missing', async () => {
    const { callImportLLM } = await import('../import-llm.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-llm-test-'));
    const workDir = path.join(dir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    const config = {
      port: 3000,
      workspace_path: workDir,
      system1_base_url: 'http://localhost:9999',
      system2_base_url: 'http://localhost:9999',
      system1_model: 'test',
      system2_model: 'test',
      embedding_url: '',
      event_bus_url: '',
      event_bus_key: '',
      agent_id: 'test',
      fire_threshold: 0.6,
      user_message_increment: 0.1,
      session_timeout_hours: 4,
      wi_weights: { text_scanner: 0.4, semantic_scorer: 0.3, state_evaluator: 0.2, temporal_evaluator: 0.1 },
      wi_activation_threshold: 0.5,
      s2_max_tokens: 4000,
      character_language: 'en' as const,
    };

    const result = await callImportLLM(config, workDir);
    expect(result).toBeNull();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('callImportLLM returns null when LLM is unreachable', async () => {
    const { callImportLLM } = await import('../import-llm.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-llm-test2-'));
    const workDir = path.join(dir, 'workspace');
    fs.mkdirSync(path.join(workDir, 'internal'), { recursive: true });

    // Write card-data.json
    const cardData: CardData = {
      system_prompt: 'Test prompt',
      post_history_instructions: '',
      mes_example: '',
      character_name: 'Test',
      detected_language: 'en',
    };
    fs.writeFileSync(
      path.join(workDir, 'internal', 'card-data.json'),
      JSON.stringify(cardData),
      'utf-8',
    );

    const config = {
      port: 3000,
      workspace_path: workDir,
      system1_base_url: 'http://localhost:9999',
      system2_base_url: 'http://localhost:9999',
      system1_model: 'test',
      system2_model: 'test',
      embedding_url: '',
      event_bus_url: '',
      event_bus_key: '',
      agent_id: 'test',
      fire_threshold: 0.6,
      user_message_increment: 0.1,
      session_timeout_hours: 4,
      wi_weights: { text_scanner: 0.4, semantic_scorer: 0.3, state_evaluator: 0.2, temporal_evaluator: 0.1 },
      wi_activation_threshold: 0.5,
      s2_max_tokens: 4000,
      character_language: 'en' as const,
    };

    const result = await callImportLLM(config, workDir);
    expect(result).toBeNull();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
