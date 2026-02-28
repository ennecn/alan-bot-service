/**
 * Card Indexer Tests -- covers language detection, token estimation, NSFW detection,
 * and full indexCards integration with mocked filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { STCardV2 } from '../../card-import/types.js';

// Mock parseCardFile before importing the module under test
vi.mock('../../card-import/png-parser.js', () => ({
  parseCardFile: vi.fn(),
}));

// Import after mock setup
import { parseCardFile } from '../../card-import/png-parser.js';
import {
  detectLanguage,
  estimateTokens,
  detectNSFW,
  indexCards,
} from '../card-indexer.js';

const mockParseCardFile = vi.mocked(parseCardFile);

const sampleCard: STCardV2 = {
  name: 'TestChar',
  description: 'A cheerful test character who loves adventure.',
  personality: 'Cheerful and curious',
  scenario: 'A quiet afternoon in the park',
  first_mes: 'Hello there! Nice to meet you.',
  mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello!',
  tags: ['adventure', 'slice-of-life'],
  character_book: {
    entries: [
      {
        keys: ['cat', 'cats'],
        content: 'TestChar loves cats and has two at home.',
        enabled: true,
      },
    ],
  },
};

const chineseCard: STCardV2 = {
  name: '小雪',
  description: '一个活泼可爱的少女，喜欢在雨天散步',
  personality: '活泼开朗',
  scenario: '雨后的公园',
  first_mes: '嗨！今天天气真好呢~',
  mes_example: '<START>\n{{user}}: 你好\n{{char}}: 嗨嗨！',
};

const japaneseCard: STCardV2 = {
  name: 'サクラ',
  description: 'おとなしくて優しい女の子です。桜が大好きです。',
  personality: 'おとなしい、やさしい',
  scenario: '桜の咲く公園で',
  first_mes: 'こんにちは！今日はいい天気ですね。',
  mes_example: '<START>\n{{user}}: やあ\n{{char}}: こんにちは！',
};

const nsfwCard: STCardV2 = {
  ...sampleCard,
  name: 'NSFWChar',
  tags: ['nsfw', 'romance', 'adult'],
  description: 'An explicit character with mature themes.',
};

// --- detectLanguage ---

describe('detectLanguage', () => {
  it('returns "en" for English text', () => {
    expect(detectLanguage('A cheerful girl who loves adventure.')).toBe('en');
  });

  it('returns "zh" for Chinese text', () => {
    expect(detectLanguage('一个活泼可爱的少女，喜欢在雨天散步')).toBe('zh');
  });

  it('returns "ja" for Japanese text with hiragana/katakana', () => {
    expect(detectLanguage('おとなしくて優しい女の子です。桜が大好きです。')).toBe('ja');
  });

  it('returns "en" for empty string', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns "en" for whitespace-only string', () => {
    expect(detectLanguage('   \n\t  ')).toBe('en');
  });

  it('returns "zh" for mixed Chinese-English text with mostly Chinese', () => {
    expect(detectLanguage('这是一个关于adventure的故事，充满了各种各样的惊喜和冒险')).toBe('zh');
  });

  it('returns "en" for mixed text with mostly English', () => {
    expect(detectLanguage('This story is about a girl named X who loves rain.')).toBe('en');
  });
});

// --- estimateTokens ---

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~4 chars per token for English', () => {
    const text = 'Hello, this is a test string for token estimation.';
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it('estimates ~1.5 chars per token for CJK text', () => {
    const text = '这是一个用于测试的中文字符串';
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 1.5));
  });

  it('returns higher count for CJK than English of same char length', () => {
    const en = 'abcd'; // 1 token
    const zh = '你好世界'; // ~3 tokens
    expect(estimateTokens(zh)).toBeGreaterThan(estimateTokens(en));
  });
});

// --- detectNSFW ---

describe('detectNSFW', () => {
  it('returns false for clean card', () => {
    expect(detectNSFW(sampleCard)).toBe(false);
  });

  it('returns true for card with nsfw tag', () => {
    expect(detectNSFW(nsfwCard)).toBe(true);
  });

  it('returns true for card with "adult" tag', () => {
    const card: STCardV2 = { ...sampleCard, tags: ['adult'] };
    expect(detectNSFW(card)).toBe(true);
  });

  it('returns true for card with "18+" tag', () => {
    const card: STCardV2 = { ...sampleCard, tags: ['18+'] };
    expect(detectNSFW(card)).toBe(true);
  });

  it('returns true for nsfw keyword in description', () => {
    const card: STCardV2 = {
      ...sampleCard,
      tags: [],
      description: 'This is an explicit adult character.',
    };
    expect(detectNSFW(card)).toBe(true);
  });

  it('returns false for card with no tags', () => {
    const card: STCardV2 = { ...sampleCard, tags: undefined };
    expect(detectNSFW(card)).toBe(false);
  });

  it('detects case-insensitive nsfw tag', () => {
    const card: STCardV2 = { ...sampleCard, tags: ['NSFW'] };
    expect(detectNSFW(card)).toBe(true);
  });
});

// --- indexCards ---

describe('indexCards', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-indexer-test-'));
    mockParseCardFile.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexes PNG and JSON card files', () => {
    fs.writeFileSync(path.join(tmpDir, 'card1.png'), 'fake-png-data');
    fs.writeFileSync(path.join(tmpDir, 'card2.json'), '{}');

    mockParseCardFile.mockImplementation((filePath: string) => {
      if (filePath.endsWith('.png')) return sampleCard;
      return chineseCard;
    });

    const index = indexCards(tmpDir);

    expect(index.entries).toHaveLength(2);
    expect(index.metadata.total).toBe(2);
    expect(index.metadata.errors).toBe(0);
  });

  it('builds correct entry metadata', () => {
    fs.writeFileSync(path.join(tmpDir, 'test.json'), '{}');

    mockParseCardFile.mockReturnValue(sampleCard);

    const index = indexCards(tmpDir);
    const entry = index.entries[0];

    expect(entry.name).toBe('TestChar');
    expect(entry.format).toBe('json');
    expect(entry.detected_language).toBe('en');
    expect(entry.tags).toEqual(['adventure', 'slice-of-life']);
    expect(entry.has_lorebook).toBe(true);
    expect(entry.wi_count).toBe(1);
    expect(entry.nsfw).toBe(false);
    expect(entry.token_estimate).toBeGreaterThan(0);
    expect(entry.size).toBeGreaterThan(0);
  });

  it('counts corrupt files as errors without throwing', () => {
    fs.writeFileSync(path.join(tmpDir, 'good.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{}');

    let callCount = 0;
    mockParseCardFile.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return sampleCard;
      throw new Error('Corrupt file');
    });

    const index = indexCards(tmpDir);

    expect(index.entries).toHaveLength(1);
    expect(index.metadata.errors).toBe(1);
    expect(index.metadata.total).toBe(1);
  });

  it('skips non-card files', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'image.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'card.json'), '{}');

    mockParseCardFile.mockReturnValue(sampleCard);

    const index = indexCards(tmpDir);

    expect(index.entries).toHaveLength(1);
    expect(mockParseCardFile).toHaveBeenCalledTimes(1);
  });

  it('recursively scans subdirectories', () => {
    const subDir = path.join(tmpDir, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'card1.json'), '{}');
    fs.writeFileSync(path.join(subDir, 'card2.json'), '{}');

    mockParseCardFile.mockReturnValue(sampleCard);

    const index = indexCards(tmpDir);

    expect(index.entries).toHaveLength(2);
  });

  it('computes by_language breakdown', () => {
    fs.writeFileSync(path.join(tmpDir, 'en.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'zh.json'), '{}');

    mockParseCardFile.mockImplementation((filePath: string) => {
      if (filePath.includes('en.json')) return sampleCard;
      return chineseCard;
    });

    const index = indexCards(tmpDir);

    expect(index.metadata.by_language['en']).toBe(1);
    expect(index.metadata.by_language['zh']).toBe(1);
  });

  it('computes by_format breakdown', () => {
    fs.writeFileSync(path.join(tmpDir, 'card.png'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'card.json'), '{}');

    mockParseCardFile.mockReturnValue(sampleCard);

    const index = indexCards(tmpDir);

    expect(index.metadata.by_format['png']).toBe(1);
    expect(index.metadata.by_format['json']).toBe(1);
  });

  it('calls onProgress callback', () => {
    fs.writeFileSync(path.join(tmpDir, 'card.json'), '{}');
    mockParseCardFile.mockReturnValue(sampleCard);

    const progress = vi.fn();
    indexCards(tmpDir, { onProgress: progress });

    expect(progress).toHaveBeenCalledWith(1, 'card.json');
  });

  it('returns empty index for empty directory', () => {
    const index = indexCards(tmpDir);

    expect(index.entries).toHaveLength(0);
    expect(index.metadata.total).toBe(0);
    expect(index.metadata.errors).toBe(0);
  });

  it('detects Japanese cards correctly', () => {
    fs.writeFileSync(path.join(tmpDir, 'ja.json'), '{}');
    mockParseCardFile.mockReturnValue(japaneseCard);

    const index = indexCards(tmpDir);

    expect(index.entries[0].detected_language).toBe('ja');
  });
});
