import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { EmotionState, Memory, BehavioralChange } from '../../types.js';

export type FeedEntryType = 'thought' | 'memory_echo' | 'mood' | 'milestone' | 'reflection';

export interface FeedEntry {
  id: string;
  agentId: string;
  type: FeedEntryType;
  content: string;
  source?: string;
  createdAt: Date;
}

/**
 * Feed Engine: generates agent-perspective "social media" posts.
 * Sources: recent memories, emotion state, growth changes, proactive impulse.
 */
export class FeedEngine {
  private stmts: ReturnType<typeof this.prepare>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepare();
  }

  private prepare() {
    return {
      insert: this.db.prepare(
        `INSERT INTO feed_entries (id, agent_id, type, content, source, created_at)
         VALUES (?, ?, ?, ?, ?, datetime(?))`
      ),
      getRecent: this.db.prepare(
        `SELECT * FROM feed_entries WHERE agent_id = ?
         ORDER BY created_at DESC LIMIT ?`
      ),
      getByType: this.db.prepare(
        `SELECT * FROM feed_entries WHERE agent_id = ? AND type = ?
         ORDER BY created_at DESC LIMIT ?`
      ),
      countRecent: this.db.prepare(
        `SELECT COUNT(*) as cnt FROM feed_entries
         WHERE agent_id = ? AND created_at > datetime('now', ?)`
      ),
    };
  }

  /** Create a feed entry */
  create(agentId: string, type: FeedEntryType, content: string, source?: string): FeedEntry {
    const id = randomUUID();
    const now = new Date();
    this.stmts.insert.run(id, agentId, type, content, source ?? null, now.toISOString());
    return { id, agentId, type, content, source, createdAt: now };
  }

  /** Get recent feed entries */
  getFeed(agentId: string, limit = 20): FeedEntry[] {
    const rows = this.stmts.getRecent.all(agentId, limit) as any[];
    return rows.map(r => this.rowToEntry(r));
  }

  /** Get feed entries by type */
  getByType(agentId: string, type: FeedEntryType, limit = 10): FeedEntry[] {
    const rows = this.stmts.getByType.all(agentId, type, limit) as any[];
    return rows.map(r => this.rowToEntry(r));
  }

  /**
   * Generate feed entries from current agent state.
   * Call periodically (e.g., after each chat or on a timer).
   */
  generateFromState(
    agentId: string,
    opts: {
      emotion?: EmotionState;
      recentMemories?: Memory[];
      growthChanges?: BehavioralChange[];
      agentName?: string;
    },
  ): FeedEntry[] {
    const entries: FeedEntry[] = [];

    // Rate limit: max 5 entries per hour
    const recentCount = (this.stmts.countRecent.get(agentId, '-1 hours') as any)?.cnt ?? 0;
    if (recentCount >= 5) return entries;

    // Mood post from emotion state
    if (opts.emotion) {
      const mood = this.emotionToMood(opts.emotion);
      if (mood) {
        entries.push(this.create(agentId, 'mood', mood, 'emotion'));
      }
    }

    // Memory echo — surface an interesting recent memory
    if (opts.recentMemories?.length) {
      const notable = opts.recentMemories.find(m => m.importance > 0.7);
      if (notable) {
        const text = `想起了一件事: ${notable.summary || notable.content.slice(0, 100)}`;
        entries.push(this.create(agentId, 'memory_echo', text, `memory:${notable.id}`));
      }
    }

    // Growth milestone
    if (opts.growthChanges?.length) {
      const recent = opts.growthChanges[0];
      if (recent.active && recent.confidence > 0.7) {
        const text = `最近的变化: ${recent.adaptation}`;
        entries.push(this.create(agentId, 'milestone', text, `growth:${recent.id}`));
      }
    }

    return entries;
  }

  private emotionToMood(e: EmotionState): string | null {
    if (e.pleasure > 0.5 && e.arousal > 0.3) return '心情很好，感觉充满活力！';
    if (e.pleasure > 0.3) return '今天心情不错~';
    if (e.pleasure < -0.5) return '有点低落...';
    if (e.arousal > 0.6) return '感觉很兴奋！';
    if (e.arousal < -0.5 && e.pleasure < 0) return '有点疲惫和沮丧...';
    return null; // neutral — no post
  }

  private rowToEntry(row: any): FeedEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type,
      content: row.content,
      source: row.source ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
