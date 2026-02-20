import type { Memory } from '../../types.js';
import type { MemoryStore } from './store.js';

interface CacheEntry {
  memories: Memory[];
  loadedAt: number;
}

/**
 * L1 Session Cache: preloads high-importance memories per agent+user,
 * sits between L0 (identity/soul) and L2 (on-demand vector+keyword).
 * TTL-based refresh avoids stale data.
 */
export class SessionCache {
  /** Cache key = `${agentId}:${userId ?? '*'}` */
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxPerAgent: number;

  constructor(opts?: { ttlMs?: number; maxPerAgent?: number }) {
    this.ttlMs = opts?.ttlMs ?? 10 * 60 * 1000; // 10 min default
    this.maxPerAgent = opts?.maxPerAgent ?? 30;
  }

  private key(agentId: string, userId?: string): string {
    return `${agentId}:${userId ?? '*'}`;
  }

  /** Get cached L1 memories, loading if missing or expired */
  get(agentId: string, store: MemoryStore, userId?: string): Memory[] {
    const k = this.key(agentId, userId);
    const entry = this.cache.get(k);
    const now = Date.now();

    if (entry && now - entry.loadedAt < this.ttlMs) {
      return entry.memories;
    }

    // Load high-importance active memories
    const memories = this.loadHighImportance(agentId, store, userId);
    this.cache.set(k, { memories, loadedAt: now });
    return memories;
  }

  /** Force refresh for an agent */
  invalidate(agentId: string, userId?: string): void {
    const k = this.key(agentId, userId);
    this.cache.delete(k);
  }

  /** Clear all cached entries */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached entries (for testing) */
  get size(): number {
    return this.cache.size;
  }

  private loadHighImportance(
    agentId: string,
    store: MemoryStore,
    userId?: string,
  ): Memory[] {
    // Fetch recent high-importance memories (importance >= 0.6)
    const types = ['episodic', 'semantic', 'procedural'] as const;
    const all: Memory[] = [];
    for (const type of types) {
      all.push(...store.getRecent(agentId, type, this.maxPerAgent));
    }

    // Filter to high importance, apply user isolation, sort by importance desc
    return all
      .filter(m => m.importance >= 0.6 && !m.fadedAt)
      .filter(m => !userId || !m.userId || m.userId === userId)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, this.maxPerAgent);
  }
}
