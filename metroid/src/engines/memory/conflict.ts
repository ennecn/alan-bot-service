import type { Memory, MemoryScore } from '../../types.js';
import type { MemoryStore } from './store.js';

export interface ConflictResult {
  winner: Memory;
  loser: Memory;
  reason: string;
}

/**
 * Memory Conflict Arbiter: detects contradictory memories and resolves them.
 * Resolution: newer + higher confidence wins, loser's confidence *= 0.5.
 */
export class ConflictArbiter {
  /**
   * Detect and resolve conflicts among retrieved memories.
   * Two memories conflict if they share 50%+ keywords but have
   * contradictory content (detected via negation patterns).
   */
  arbitrate(scored: MemoryScore[], store: MemoryStore): ConflictResult[] {
    const resolved: ConflictResult[] = [];
    const memories = scored.map(s => s.memory);

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i];
        const b = memories[j];

        if (this.areConflicting(a, b)) {
          const result = this.resolve(a, b);
          resolved.push(result);

          // Penalize loser's confidence
          const newConf = result.loser.confidence * 0.5;
          store.updateConfidence?.(result.loser.id, newConf);
          result.loser.confidence = newConf;
        }
      }
    }

    return resolved;
  }

  private areConflicting(a: Memory, b: Memory): boolean {
    // Must share keywords
    const aKw = new Set(a.keywords.map(k => k.toLowerCase()));
    const bKw = new Set(b.keywords.map(k => k.toLowerCase()));
    const shared = [...aKw].filter(k => bKw.has(k));
    const minSize = Math.min(aKw.size, bKw.size);
    if (minSize === 0 || shared.length / minSize < 0.5) return false;

    // Check for negation patterns between content
    const textA = (a.summary || a.content).toLowerCase();
    const textB = (b.summary || b.content).toLowerCase();
    return this.hasNegation(textA, textB);
  }

  private hasNegation(a: string, b: string): boolean {
    const negPatterns = [
      // Chinese negation
      /不是/, /不会/, /没有/, /不喜欢/, /不想/, /不能/,
      // English negation
      /\bnot\b/, /\bnever\b/, /\bdon't\b/, /\bdoesn't\b/, /\bwon't\b/,
    ];

    for (const pat of negPatterns) {
      const aHas = pat.test(a);
      const bHas = pat.test(b);
      // One has negation, the other doesn't → potential conflict
      if (aHas !== bHas) return true;
    }
    return false;
  }

  private resolve(a: Memory, b: Memory): ConflictResult {
    // Prefer: higher confidence, then more recent
    const aScore = a.confidence * 2 + (a.createdAt.getTime() / 1e12);
    const bScore = b.confidence * 2 + (b.createdAt.getTime() / 1e12);

    if (aScore >= bScore) {
      return { winner: a, loser: b, reason: `confidence ${a.confidence.toFixed(2)} > ${b.confidence.toFixed(2)}` };
    }
    return { winner: b, loser: a, reason: `confidence ${b.confidence.toFixed(2)} > ${a.confidence.toFixed(2)}` };
  }
}
