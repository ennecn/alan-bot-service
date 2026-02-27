/**
 * Card Mapper — maps parsed STCardV2 to Alan workspace files.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { WIEntry } from '../types/actions.js';
import { WIStore } from '../storage/wi-store.js';
import { initDatabase } from '../storage/database.js';
import type { STCardV2, STCardWIEntry, BehavioralEngineConfig } from './types.js';

const SELECTIVE_LOGIC_MAP: Record<number, WIEntry['selective_logic']> = {
  0: 'AND_ANY',
  1: 'AND_ALL',
  2: 'NOT_ANY',
  3: 'NOT_ALL',
};

export interface CardData {
  system_prompt: string;
  post_history_instructions: string;
  mes_example: string;
  character_name: string;
  detected_language: string;
  output_style?: 'default' | 'casual';
}

export interface MapResult {
  identity_path: string;
  system_prompt: string | undefined;
  post_history_instructions: string | undefined;
  mes_example: string;
  greetings: string[];
  behavioral_engine: BehavioralEngineConfig | undefined;
  wi_count: number;
}

export function mapCard(card: STCardV2, workspacePath: string): MapResult {
  fs.mkdirSync(path.join(workspacePath, 'internal'), { recursive: true });

  // 1. Write IDENTITY.md
  const identityPath = path.join(workspacePath, 'IDENTITY.md');
  const identityMd = buildIdentityMd(card);
  fs.writeFileSync(identityPath, identityMd, 'utf-8');

  // 2. Write greeting pool
  const greetings = [card.first_mes, ...(card.alternate_greetings ?? [])].filter(Boolean);
  const greetingsPath = path.join(workspacePath, 'internal', 'greetings.json');
  fs.writeFileSync(greetingsPath, JSON.stringify(greetings, null, 2), 'utf-8');

  // 3. Import WI entries to SQLite
  let wiCount = 0;
  if (card.character_book?.entries?.length) {
    const db = initDatabase(workspacePath);
    const wiStore = new WIStore(db);
    for (const raw of card.character_book.entries) {
      const entry = mapWIEntry(raw, wiCount);
      wiStore.upsertEntry(entry);
      wiCount++;
    }
    db.close();
  }

  // 4. Extract behavioral_engine
  const behavioralEngine = card.extensions?.behavioral_engine;

  return {
    identity_path: identityPath,
    system_prompt: card.system_prompt || undefined,
    post_history_instructions: card.post_history_instructions || undefined,
    mes_example: card.mes_example || '',
    greetings,
    behavioral_engine: behavioralEngine,
    wi_count: wiCount,
  };
}

function buildIdentityMd(card: STCardV2): string {
  const sections: string[] = [`# ${card.name}`, ''];
  if (card.description) {
    sections.push('## Description', '', card.description, '');
  }
  if (card.personality) {
    sections.push('## Personality', '', card.personality, '');
  }
  if (card.scenario) {
    sections.push('## Scenario', '', card.scenario, '');
  }
  return sections.join('\n');
}

/**
 * Write card prompt data to internal/card-data.json for use by prompt assembler.
 */
export function persistCardData(
  card: STCardV2,
  workspacePath: string,
  detectedLanguage: string,
): void {
  const internalDir = path.join(workspacePath, 'internal');
  fs.mkdirSync(internalDir, { recursive: true });

  const systemPrompt = card.system_prompt
    || [card.description, card.personality, card.scenario].filter(Boolean).join('\n\n');

  const data: CardData = {
    system_prompt: systemPrompt,
    post_history_instructions: card.post_history_instructions || '',
    mes_example: card.mes_example || '',
    character_name: card.name,
    detected_language: detectedLanguage,
  };

  fs.writeFileSync(
    path.join(internalDir, 'card-data.json'),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

function mapWIEntry(raw: STCardWIEntry, index: number): WIEntry {
  const id = `wi-${index}`;
  const selectiveLogic = raw.selective_logic != null
    ? SELECTIVE_LOGIC_MAP[raw.selective_logic]
    : undefined;

  return {
    id,
    keys: raw.keys,
    secondary_keys: raw.secondary_keys,
    content: raw.content,
    comment: raw.comment,
    selective_logic: selectiveLogic,
    constant: raw.constant,
    enabled: raw.enabled ?? true,
    position: raw.position,
    depth: raw.depth,
    order: raw.order,
    weight: raw.weight,
    probability: raw.probability,
    sticky: raw.sticky,
    cooldown: raw.cooldown,
    delay: raw.delay,
    group: raw.group,
    scan_depth: raw.scan_depth,
    case_sensitive: raw.case_sensitive,
    embedding: 'pending',
  };
}
