import type { Memory, MemoryQuery, MemoryScore } from '../../types.js';
import type { MemoryStore } from './store.js';
import { EmbeddingService } from './embedding.js';

/**
 * Layered retrieval funnel:
 * Query → Vector Search (semantic) + Keyword Match (lexical) → Time Window → Scoring → top-N
 *
 * Phase 2: vector search via embedding + cosine similarity.
 */
export class MemoryRetriever {
  constructor(
    private store: MemoryStore,
    private embedding?: EmbeddingService,
  ) {}

  async retrieve(query: MemoryQuery): Promise<MemoryScore[]> {
    const limit = query.limit ?? 5;
    const keywords = this.extractKeywords(query.text);
    const includeFaded = query.includesFaded ?? false;

    // Layer 0: Vector search (semantic, non-blocking)
    let vectorCandidates: Map<string, number> = new Map();
    if (this.embedding) {
      try {
        const queryVec = await this.embedding.embed(query.text);
        if (queryVec) {
          const stored = this.store.getWithEmbedding(query.agentId, 500);
          for (const m of stored) {
            const memVec = EmbeddingService.fromBuffer(m.embeddingBuf);
            const sim = EmbeddingService.cosineSimilarity(queryVec, memVec);
            if (sim > 0.3) { // threshold for relevance
              vectorCandidates.set(m.id, sim);
            }
          }
        }
      } catch (err) {
        console.warn('[MemoryRetriever] Vector search failed, falling back to keyword:', err);
      }
    }

    // Layer 1: Keyword match (coarse, up to 100)
    let candidates: Memory[] = [];
    for (const kw of keywords) {
      const matches = this.store.searchByKeyword(query.agentId, kw, 100, includeFaded);
      candidates.push(...matches);
    }

    // Layer 2: Time window (also fetch recent as fallback)
    const timeHours = query.timeWindowHours ?? 72;
    const recentMemories = this.store.searchByTimeWindow(
      query.agentId, timeHours, 100, includeFaded
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
      score: this.scoreMemory(m, keywords, vectorCandidates),
      matchReason: this.explainMatch(m, keywords, vectorCandidates),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Record recall for top results
    const results = scored.slice(0, limit);
    for (const r of results) {
      this.store.recordRecall(r.memory.id);
    }

    // Nostalgia trigger: 15% chance to surface a faded memory
    if (Math.random() < 0.15) {
      const fadedMemories = this.store.searchByTimeWindow(query.agentId, 720, 10, true)
        .filter(m => m.fadedAt != null);
      if (fadedMemories.length > 0) {
        const nostalgic = fadedMemories[Math.floor(Math.random() * fadedMemories.length)];
        // Only add if not already in results
        if (!results.some(r => r.memory.id === nostalgic.id)) {
          results.push({
            memory: nostalgic,
            score: 0.1,
            matchReason: 'nostalgia trigger',
          });
        }
      }
    }

    return results;
  }

  private scoreMemory(memory: Memory, queryKeywords: string[], vectorScores?: Map<string, number>): number {
    // Recall probability: low-importance memories may be "forgotten"
    // importance < 0.3 → 30% recall, 0.3-0.6 → 60%, > 0.6 → 100%
    const recallProbability = memory.importance < 0.3 ? 0.3
      : memory.importance < 0.6 ? 0.6
      : 1.0;
    if (Math.random() > recallProbability) {
      return 0; // "想不起来了"
    }

    const now = Date.now();
    const ageHours = (now - memory.createdAt.getTime()) / (1000 * 60 * 60);

    // Base importance
    const base = memory.importance;

    // Recency: exponential decay, half-life = 24h
    const recency = Math.exp(-ageHours / 24);

    // Frequency: log scale of recall count
    const frequency = 1 + Math.log1p(memory.recallCount) * 0.3;

    // Keyword overlap — strong boost to reward direct relevance
    const kwSet = new Set(memory.keywords.map(k => k.toLowerCase()));
    const overlap = queryKeywords.filter(k => kwSet.has(k.toLowerCase())).length;
    const keywordBoost = 1 + overlap * 2.0;

    // Content match bonus: query keywords found in actual memory content
    const contentLower = (memory.content || '').toLowerCase();
    const contentHits = queryKeywords.filter(k => contentLower.includes(k.toLowerCase())).length;
    const contentBoost = 1 + contentHits * 1.5;

    // Vector similarity boost (0-2x multiplier)
    const vecSim = vectorScores?.get(memory.id) ?? 0;
    const vectorBoost = 1 + vecSim * 2;

    return base * recency * frequency * keywordBoost * contentBoost * vectorBoost;
  }

  private explainMatch(memory: Memory, queryKeywords: string[], vectorScores?: Map<string, number>): string {
    const kwSet = new Set(memory.keywords.map(k => k.toLowerCase()));
    const matched = queryKeywords.filter(k => kwSet.has(k.toLowerCase()));
    const vecSim = vectorScores?.get(memory.id);

    const reasons: string[] = [];
    if (matched.length > 0) reasons.push(`keyword: ${matched.join(', ')}`);
    if (vecSim && vecSim > 0.3) reasons.push(`semantic: ${(vecSim * 100).toFixed(0)}%`);
    return reasons.length > 0 ? reasons.join(' + ') : 'recent memory';
  }

  /**
   * Keyword extraction with CJK n-gram support.
   * English: split on whitespace. Chinese: 2-4 char sliding window.
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];

    // Extract English words (2+ chars)
    const english = text.match(/[a-zA-Z]{2,}/g) || [];
    keywords.push(...english.map(w => w.toLowerCase()));

    // Extract CJK n-grams (2-4 chars)
    const cjk = text.replace(/[^\u4e00-\u9fff]/g, '');
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i <= cjk.length - n; i++) {
        keywords.push(cjk.slice(i, i + n));
      }
    }

    // Deduplicate and cap
    return [...new Set(keywords)].slice(0, 15);
  }
}
