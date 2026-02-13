import type { Memory, MemoryQuery, MemoryScore } from '../../types.js';
import type { MemoryStore } from './store.js';

/**
 * Layered retrieval funnel (from 阿澪's feedback):
 * Query → Keyword Match (fast, coarse) → Time Window → Scoring → top-N
 *
 * Phase 1: no vector search, keyword + time + importance scoring only.
 */
export class MemoryRetriever {
  constructor(private store: MemoryStore) {}

  async retrieve(query: MemoryQuery): Promise<MemoryScore[]> {
    const limit = query.limit ?? 5;
    const keywords = this.extractKeywords(query.text);

    // Layer 1: Keyword match (coarse, up to 100)
    let candidates: Memory[] = [];
    for (const kw of keywords) {
      const matches = this.store.searchByKeyword(query.agentId, kw, 100);
      candidates.push(...matches);
    }

    // Layer 2: Time window (also fetch recent as fallback)
    const timeHours = query.timeWindowHours ?? 72;
    const recentMemories = this.store.searchByTimeWindow(
      query.agentId, timeHours, 100
    );

    // Merge and deduplicate
    const seen = new Set<string>();
    const merged: Memory[] = [];
    for (const m of [...candidates, ...recentMemories]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }

    // Apply privacy filter
    const filtered = query.privacyFilter
      ? merged.filter(m => query.privacyFilter!.includes(m.privacy))
      : merged;

    // Exclude faded unless requested
    const active = query.includesFaded
      ? filtered
      : filtered.filter(m => !m.fadedAt);

    // Layer 3: Score and rank
    const scored: MemoryScore[] = active.map(m => ({
      memory: m,
      score: this.scoreMemory(m, keywords),
      matchReason: this.explainMatch(m, keywords),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Record recall for top results
    const results = scored.slice(0, limit);
    for (const r of results) {
      this.store.recordRecall(r.memory.id);
    }

    return results;
  }

  private scoreMemory(memory: Memory, queryKeywords: string[]): number {
    const now = Date.now();
    const ageHours = (now - memory.createdAt.getTime()) / (1000 * 60 * 60);

    // Base importance
    const base = memory.importance;

    // Recency: exponential decay, half-life = 24h
    const recency = Math.exp(-ageHours / 24);

    // Frequency: log scale of recall count
    const frequency = 1 + Math.log1p(memory.recallCount) * 0.3;

    // Keyword overlap
    const kwSet = new Set(memory.keywords.map(k => k.toLowerCase()));
    const overlap = queryKeywords.filter(k => kwSet.has(k.toLowerCase())).length;
    const keywordBoost = 1 + overlap * 0.5;

    return base * recency * frequency * keywordBoost;
  }

  private explainMatch(memory: Memory, queryKeywords: string[]): string {
    const kwSet = new Set(memory.keywords.map(k => k.toLowerCase()));
    const matched = queryKeywords.filter(k => kwSet.has(k.toLowerCase()));

    if (matched.length > 0) {
      return `keyword match: ${matched.join(', ')}`;
    }
    return 'recent memory';
  }

  /** Simple keyword extraction: split on whitespace + punctuation, filter short words */
  private extractKeywords(text: string): string[] {
    return text
      .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')  // keep CJK + alphanumeric
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .slice(0, 10);  // cap at 10 keywords
  }
}
