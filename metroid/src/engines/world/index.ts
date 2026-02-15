import type Database from 'better-sqlite3';
import type { Engine, EngineContext, PromptFragment, STPosition } from '../../types.js';

type SelectiveLogic = 'AND_ANY' | 'NOT_ALL' | 'NOT_ANY' | 'AND_ALL';

interface WorldEntry {
  id: string;
  keywords: string[];
  secondaryKeywords: string[];
  content: string;
  priority: number;
  scope: string;
  scopeTarget?: string;
  enabled: boolean;
  selectiveLogic?: SelectiveLogic;
  position?: STPosition;
  depth?: number;
  probability: number;
  constant: boolean;
}

/**
 * World Engine: keyword-triggered context injection.
 *
 * Classic mode: full ST World Info behavior (selective logic, position/depth, probability).
 * Enhanced mode: priority-based, ignores position/depth, uses Metroid's compiler.
 */
export class WorldEngine implements Engine {
  readonly name = 'world';

  private entries: WorldEntry[] = [];

  constructor(private db: Database.Database) {
    this.loadEntries();
  }

  reload(): void {
    this.loadEntries();
  }

  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    if (this.entries.length === 0) return [];

    // Build scan text: current message + last few messages
    const scanParts = [context.message.content];
    const recentHistory = context.conversationHistory.slice(-4);
    for (const msg of recentHistory) {
      scanParts.push(msg.content);
    }
    const scanText = scanParts.join(' ').toLowerCase();

    const isClassic = context.mode === 'classic';

    // Find matching entries
    const matched: WorldEntry[] = [];
    for (const entry of this.entries) {
      if (!entry.enabled) continue;

      // Constant entries always trigger (ST behavior)
      if (entry.constant) {
        matched.push(entry);
        continue;
      }

      // Primary keyword match (OR logic)
      if (!this.matchesKeywords(entry.keywords, scanText)) continue;

      // Classic mode: apply selective logic on secondary keywords
      if (isClassic && entry.selectiveLogic && entry.secondaryKeywords.length > 0) {
        if (!this.checkSelectiveLogic(entry.secondaryKeywords, entry.selectiveLogic, scanText)) {
          continue;
        }
      }

      // Classic mode: probability filter
      if (isClassic && entry.probability < 100) {
        if (Math.random() * 100 >= entry.probability) continue;
      }

      matched.push(entry);
    }

    if (matched.length === 0) return [];

    // Sort by priority (higher first), cap at 15
    matched.sort((a, b) => b.priority - a.priority);
    const selected = matched.slice(0, 15);

    if (isClassic) {
      return this.buildClassicFragments(selected);
    }
    return this.buildEnhancedFragments(selected);
  }

  fallback(): PromptFragment[] {
    return [];
  }

  /** Search loaded entries by keyword (for CLI) */
  search(keyword: string): Array<{ id: string; keywords: string[]; content: string; priority: number }> {
    const kw = keyword.toLowerCase();
    return this.entries
      .filter(e => e.keywords.some(k => k.toLowerCase().includes(kw)) || e.content.toLowerCase().includes(kw))
      .slice(0, 20)
      .map(e => ({ id: e.id, keywords: e.keywords, content: e.content, priority: e.priority }));
  }

  /** Classic mode: group entries by ST position, return separate fragments */
  private buildClassicFragments(entries: WorldEntry[]): PromptFragment[] {
    const groups = new Map<string, WorldEntry[]>();

    for (const entry of entries) {
      const pos = entry.position || 'after_char';
      if (!groups.has(pos)) groups.set(pos, []);
      groups.get(pos)!.push(entry);
    }

    const fragments: PromptFragment[] = [];
    for (const [pos, group] of groups) {
      const worldText = group
        .map(e => `[${e.keywords[0]}] ${e.content}`)
        .join('\n\n');

      fragments.push({
        source: 'world',
        content: `<world_info>\n${worldText}\n</world_info>`,
        priority: 50,
        tokens: Math.ceil(worldText.length / 3),
        required: false,
        position: pos as STPosition,
        depth: pos === 'at_depth' ? (group[0]?.depth ?? 4) : undefined,
      });
    }

    return fragments;
  }

  /** Enhanced mode: single fragment, priority-based */
  private buildEnhancedFragments(entries: WorldEntry[]): PromptFragment[] {
    const worldText = entries
      .map(e => `[${e.keywords[0]}] ${e.content}`)
      .join('\n\n');

    return [{
      source: 'world',
      content: `<world_info>\n${worldText}\n</world_info>`,
      priority: 50,
      tokens: Math.ceil(worldText.length / 3),
      required: false,
    }];
  }

  /** Check ST selective logic against secondary keywords */
  private checkSelectiveLogic(
    secondaryKws: string[],
    logic: SelectiveLogic,
    scanText: string,
  ): boolean {
    const matches = secondaryKws.filter(kw => {
      const kwLower = kw.toLowerCase().trim();
      if (kwLower.length < 2) return false;
      return scanText.includes(kwLower);
    });

    switch (logic) {
      case 'AND_ANY':  return matches.length > 0;
      case 'AND_ALL':  return matches.length === secondaryKws.length;
      case 'NOT_ANY':  return matches.length === 0;
      case 'NOT_ALL':  return matches.length < secondaryKws.length;
      default:         return true;
    }
  }

  private matchesKeywords(keywords: string[], scanText: string): boolean {
    for (const kw of keywords) {
      if (!kw) continue;
      const kwLower = kw.toLowerCase().trim();
      if (kwLower.length < 2) continue;

      if (kwLower.startsWith('/') && kwLower.endsWith('/')) {
        try {
          const regex = new RegExp(kwLower.slice(1, -1), 'i');
          if (regex.test(scanText)) return true;
        } catch {
          // invalid regex, fall through
        }
      }

      if (scanText.includes(kwLower)) return true;
    }
    return false;
  }

  private loadEntries(): void {
    const rows = this.db.prepare(
      'SELECT * FROM world_entries WHERE enabled = 1'
    ).all() as any[];

    this.entries = rows.map(r => ({
      id: r.id,
      keywords: r.keywords ? r.keywords.split(',').map((k: string) => k.trim()) : [],
      secondaryKeywords: r.secondary_keywords ? r.secondary_keywords.split(',').map((k: string) => k.trim()) : [],
      content: r.content,
      priority: r.priority,
      scope: r.scope,
      scopeTarget: r.scope_target ?? undefined,
      enabled: !!r.enabled,
      selectiveLogic: r.selective_logic ?? undefined,
      position: r.position ?? undefined,
      depth: r.depth ?? undefined,
      probability: r.probability ?? 100,
      constant: !!r.constant,
    }));
  }
}