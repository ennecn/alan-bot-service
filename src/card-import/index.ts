/**
 * Card Import Orchestrator — top-level importCard function.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCardFile } from './png-parser.js';
import { mapCard, persistCardData } from './mapper.js';
import { validateSchemaVersion } from './schema-version.js';
import { backfillEmbeddings } from '../embedding/backfill.js';
import { initDatabase } from '../storage/database.js';
import { WIStore } from '../storage/wi-store.js';
import type { EmbeddingConfig } from '../embedding/client.js';
import type { ImportResult } from './types.js';

export interface ImportOptions {
  reimport?: boolean;
  embeddingConfig?: EmbeddingConfig;
}

/**
 * Import an ST Card V2 from a PNG or JSON file into an Alan workspace.
 * If reimport=true: overwrites IDENTITY.md and WI, preserves MEMORY.md and emotion_state.md.
 * If embeddingConfig provided, backfills embeddings for WI entries after import.
 */
export async function importCard(
  cardPath: string,
  workspacePath: string,
  options?: ImportOptions,
): Promise<ImportResult> {
  const reimport = options?.reimport ?? false;

  // Preserve files on reimport
  let memoryBackup: string | null = null;
  let emotionBackup: string | null = null;
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  const emotionPath = path.join(workspacePath, 'emotion_state.md');

  if (reimport) {
    if (fs.existsSync(memoryPath)) memoryBackup = fs.readFileSync(memoryPath, 'utf-8');
    if (fs.existsSync(emotionPath)) emotionBackup = fs.readFileSync(emotionPath, 'utf-8');
  }

  // Parse card
  const card = parseCardFile(cardPath);

  // Validate schema version from behavioral_engine extension
  validateSchemaVersion(card.extensions?.behavioral_engine?.schema_version);

  // Map to workspace
  const result = mapCard(card, workspacePath);

  // Restore preserved files
  if (reimport) {
    if (memoryBackup !== null) fs.writeFileSync(memoryPath, memoryBackup, 'utf-8');
    if (emotionBackup !== null) fs.writeFileSync(emotionPath, emotionBackup, 'utf-8');
  }

  // Detect language from description
  const lang = detectLanguage(card.description);

  // Persist card prompt data for prompt assembler
  persistCardData(card, workspacePath, lang);

  // Backfill embeddings for WI entries if config provided
  if (options?.embeddingConfig && result.wi_count > 0) {
    try {
      const db = initDatabase(workspacePath);
      const wiStore = new WIStore(db);
      const embResult = await backfillEmbeddings(wiStore, options.embeddingConfig);
      console.log(`[card-import] embedding backfill: ${embResult.processed} processed, ${embResult.failed} failed`);
      db.close();
    } catch (err) {
      console.error('[card-import] embedding backfill failed (non-fatal):', err);
    }
  }

  return {
    ...result,
    detected_language: lang,
  };
}

/** Simple language detection based on character ranges. */
function detectLanguage(text: string): string {
  if (!text) return 'en';

  let cjk = 0;
  let ja = 0;
  let total = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0x7f) {
      total++;
      // CJK Unified Ideographs
      if (code >= 0x4e00 && code <= 0x9fff) cjk++;
      // Hiragana + Katakana
      if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) ja++;
    }
  }

  if (total === 0) return 'en';
  if (ja > total * 0.1) return 'ja';
  if (cjk > total * 0.3) return 'zh';
  return 'en';
}

export { parseCardFile } from './png-parser.js';
export type { STCardV2, BehavioralEngineConfig, ImportResult } from './types.js';
