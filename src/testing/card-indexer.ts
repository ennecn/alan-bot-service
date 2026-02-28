/**
 * NAS Card Indexer -- Scans directories recursively for ST character cards.
 * Reuses png-parser.ts for PNG tEXt chunk extraction.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CardIndexEntry, CardIndex } from './types.js';
import { parseCardFile } from '../card-import/png-parser.js';
import type { STCardV2 } from '../card-import/types.js';

/** CJK Unicode ranges for language detection */
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/** Japanese-specific characters (hiragana + katakana) */
const JA_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/g;

/** NSFW tag patterns (case-insensitive) */
const NSFW_TAGS = ['nsfw', 'adult', 'explicit', '18+', 'r18', 'smut', 'erotic', 'lewd'];

/** NSFW keyword patterns for description scanning */
const NSFW_KEYWORDS = /\b(nsfw|explicit|18\+|r18|smut|erotic|lewd|hentai|pornographic)\b/i;

/**
 * Detect the dominant language of a text string.
 * Returns 'zh', 'ja', or 'en'.
 */
export function detectLanguage(text: string): string {
  if (!text) return 'en';

  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const totalChars = text.replace(/\s/g, '').length;

  if (totalChars === 0) return 'en';

  const cjkRatio = cjkCount / totalChars;

  // If less than 10% CJK, it's English
  if (cjkRatio < 0.1) return 'en';

  // Distinguish Japanese from Chinese by hiragana/katakana presence
  const jaMatches = text.match(JA_REGEX);
  const jaCount = jaMatches ? jaMatches.length : 0;

  if (jaCount > 0 && jaCount / cjkCount > 0.1) return 'ja';

  return 'zh';
}

/**
 * Estimate token count for a text string.
 * Uses ~4 chars/token for English, ~1.5 chars/token for CJK.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const lang = detectLanguage(text);
  if (lang === 'en') {
    return Math.ceil(text.length / 4);
  }
  return Math.ceil(text.length / 1.5);
}

/**
 * Detect whether a card contains NSFW content.
 * Checks tags and description text.
 */
export function detectNSFW(card: STCardV2): boolean {
  // Check tags
  if (card.tags) {
    for (const tag of card.tags) {
      if (NSFW_TAGS.some(marker => tag.toLowerCase().includes(marker))) {
        return true;
      }
    }
  }

  // Check description for NSFW keywords
  if (card.description && NSFW_KEYWORDS.test(card.description)) {
    return true;
  }

  return false;
}

/**
 * Collect all card-relevant text from a card for token estimation.
 */
function collectCardText(card: STCardV2): string {
  const parts = [
    card.description,
    card.personality,
    card.scenario,
    card.first_mes,
    card.mes_example,
    card.system_prompt ?? '',
    card.post_history_instructions ?? '',
    card.creator_notes ?? '',
    ...(card.alternate_greetings ?? []),
  ];

  if (card.character_book) {
    for (const entry of card.character_book.entries) {
      parts.push(entry.content);
    }
  }

  return parts.join('\n');
}

/**
 * Recursively walk a directory and collect file paths matching extensions.
 */
function walkDir(dir: string, extensions: Set<string>): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Index all character cards in a directory tree.
 * Returns a CardIndex with entries and metadata.
 */
export function indexCards(
  scanPath: string,
  options?: { onProgress?: (count: number, current: string) => void },
): CardIndex {
  const resolvedPath = path.resolve(scanPath);
  const extensions = new Set(['.png', '.json']);
  const files = walkDir(resolvedPath, extensions);

  const entries: CardIndexEntry[] = [];
  let errorCount = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);

    options?.onProgress?.(i + 1, fileName);

    try {
      const card = parseCardFile(filePath);
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const fullText = collectCardText(card);

      const entry: CardIndexEntry = {
        path: filePath,
        name: card.name,
        format: ext === '.png' ? 'png' : 'json',
        size: stat.size,
        nsfw: detectNSFW(card),
        detected_language: detectLanguage(card.description),
        token_estimate: estimateTokens(fullText),
        tags: card.tags ?? [],
        has_lorebook: !!card.character_book && card.character_book.entries.length > 0,
        wi_count: card.character_book?.entries.length ?? 0,
      };

      entries.push(entry);
    } catch {
      errorCount++;
    }
  }

  // Build metadata
  const byLanguage: Record<string, number> = {};
  const byFormat: Record<string, number> = {};

  for (const entry of entries) {
    byLanguage[entry.detected_language] = (byLanguage[entry.detected_language] ?? 0) + 1;
    byFormat[entry.format] = (byFormat[entry.format] ?? 0) + 1;
  }

  return {
    entries,
    metadata: {
      scan_date: new Date().toISOString(),
      scan_path: resolvedPath,
      total: entries.length,
      by_language: byLanguage,
      by_format: byFormat,
      errors: errorCount,
    },
  };
}
