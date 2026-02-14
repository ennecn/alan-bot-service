import { extractPngText } from './png-parser.js';
import type { MetroidCard } from '../types.js';

/** Raw ST Character Card V2 data structure */
interface STCardV2 {
  spec: string;
  spec_version: string;
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    tags: string[];
    creator: string;
    character_version: string;
    alternate_greetings: string[];
    extensions: {
      talkativeness?: number;
      fav?: boolean;
      world?: string;
      depth_prompt?: {
        prompt: string;
        depth: number;
        role: string;
      };
    };
    character_book?: STCharacterBook;
  };
}

export interface STCharacterBook {
  name?: string;
  entries: STBookEntry[];
}

export interface STBookEntry {
  id: number;
  keys: string[];
  secondary_keys: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  insertion_order: number;
  enabled: boolean;
  position: string;
  extensions: Record<string, unknown>;
}

export interface STCardImportResult {
  card: MetroidCard;
  rawSTCard: STCardV2;
  characterBook?: STCharacterBook;
  linkedWorldName?: string;  // external world book name
  warnings: string[];
}

/**
 * Import a SillyTavern Character Card V2 from a PNG file.
 * Extracts JSON from PNG tEXt chunk, maps to MetroidCard format.
 */
export function importSTCardFromPng(pngPath: string, userName = '用户'): STCardImportResult {
  const textChunks = extractPngText(pngPath);
  const warnings: string[] = [];

  // Try V3 first, then V2
  let rawJson: string | undefined;
  if (textChunks.has('ccv3')) {
    rawJson = Buffer.from(textChunks.get('ccv3')!, 'base64').toString('utf-8');
  } else if (textChunks.has('chara')) {
    rawJson = Buffer.from(textChunks.get('chara')!, 'base64').toString('utf-8');
  }

  if (!rawJson) {
    throw new Error('No character card data found in PNG (no ccv3 or chara tEXt chunk)');
  }

  const stCard: STCardV2 = JSON.parse(rawJson);
  const d = stCard.data;

  // Replace ST placeholders
  const replace = (text: string): string =>
    text
      .replace(/\{\{char\}\}/gi, d.name)
      .replace(/\{\{user\}\}/gi, userName);

  // Map to MetroidCard
  const card: MetroidCard = {
    name: d.name,
    description: replace(d.description),
    personality: replace(d.personality),
    firstMes: replace(d.first_mes),
    mesExample: replace(d.mes_example),
    scenario: replace(d.scenario),
    creatorNotes: d.creator_notes,

    // Metroid extensions — defaults, user can customize later
    soul: {
      immutableValues: [],
      mutableTraits: [],
    },
    emotion: {
      baseline: { pleasure: 0, arousal: 0, dominance: 0 },
      intensityDial: d.extensions?.talkativeness ?? 0.5,
    },
    memoryStyle: {
      encodingRate: 0.3,
      forgettingCurve: 'normal',
      nostalgiaTendency: 0.5,
    },
    growth: {
      enabled: false, // disabled for imported cards by default
      maxDrift: 0.3,
      logChanges: true,
    },
  };

  // Extract linked world book name
  const linkedWorldName = d.extensions?.world || undefined;
  if (linkedWorldName) {
    warnings.push(`角色卡关联了外部世界书: "${linkedWorldName}"，需要单独导入`);
  }

  // Extract embedded character book
  const characterBook = d.character_book;
  if (characterBook?.entries?.length) {
    warnings.push(`角色卡内嵌了 ${characterBook.entries.length} 条世界书条目`);
  }

  // Note missing Metroid-specific fields
  if (!card.soul?.immutableValues?.length) {
    warnings.push('灵魂锚点(immutable_values)为空，建议手动设置');
  }

  return { card, rawSTCard: stCard, characterBook, linkedWorldName, warnings };
}

/**
 * Import a SillyTavern Character Card from a JSON file (non-PNG format).
 */
export function importSTCardFromJson(jsonPath: string, userName = '用户'): STCardImportResult {
  const { readFileSync } = require('fs');
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  // Handle both wrapped (spec/data) and flat formats
  const stCard: STCardV2 = raw.spec ? raw : { spec: 'chara_card_v2', spec_version: '2.0', data: raw };

  // Reuse the same mapping logic by creating a temporary result
  const d = stCard.data;
  const replace = (text: string): string =>
    text
      .replace(/\{\{char\}\}/gi, d.name)
      .replace(/\{\{user\}\}/gi, userName);

  const card: MetroidCard = {
    name: d.name,
    description: replace(d.description || ''),
    personality: replace(d.personality || ''),
    firstMes: replace(d.first_mes || ''),
    mesExample: replace(d.mes_example || ''),
    scenario: replace(d.scenario || ''),
    creatorNotes: d.creator_notes,
    soul: { immutableValues: [], mutableTraits: [] },
    emotion: {
      baseline: { pleasure: 0, arousal: 0, dominance: 0 },
      intensityDial: d.extensions?.talkativeness ?? 0.5,
    },
    memoryStyle: { encodingRate: 0.3, forgettingCurve: 'normal', nostalgiaTendency: 0.5 },
    growth: { enabled: false, maxDrift: 0.3, logChanges: true },
  };

  const warnings: string[] = [];
  if (!card.soul?.immutableValues?.length) {
    warnings.push('灵魂锚点(immutable_values)为空，建议手动设置');
  }

  return {
    card,
    rawSTCard: stCard,
    characterBook: d.character_book,
    linkedWorldName: d.extensions?.world,
    warnings,
  };
}
