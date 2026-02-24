import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  Engine, EngineContext, PromptFragment,
  SocialPost, SocialReaction, SocialCreditState,
  SocialPostSourceType, SocialPostVisibility, SocialActorType,
  SocialReactionType, SocialConnection, EmotionState, BehavioralState,
} from '../../types.js';
import type { IdentityEngine } from '../identity/index.js';
import type { EmotionEngine } from '../emotion/index.js';
import type { MetroidConfig } from '../../config.js';

// === Layer 0: Relationship types (preserved) ===

export type RelationshipType = 'acquaintance' | 'friend' | 'rival' | 'family' | 'romantic' | 'mentor';

export interface Relationship {
  id: string;
  agentA: string;
  agentB: string;
  type: RelationshipType;
  affinity: number;       // -1.0 to +1.0
  notes?: string;
  interactionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// === V8: Privacy filter patterns ===
const USER_NAME_PATTERNS = [
  /用户\s*[\u4e00-\u9fff\w]+/g,
  /(?:跟|和|与)\s*([\u4e00-\u9fff]{2,4})\s*(?:聊|说|谈|讨论)/g,
  /@[\w]+/g,
];

/**
 * Social Engine — Agent-to-agent relationships + V8 AI 朋友圈.
 *
 * Layer 0: Relationship tracking (original)
 * Layer 1: Social posts (朋友圈), reactions, socialCredit, quota
 */
export class SocialEngine implements Engine {
  readonly name = 'social';

  private stmts: ReturnType<typeof this.prepareStatements>;

  // V8: Callbacks
  private onPostFn?: (agentId: string, post: SocialPost) => void;
  private onReactionFn?: (postId: string, reaction: SocialReaction) => void;
  private generateCommentFn?: (agentId: string, prompt: string) => Promise<string>;

  constructor(
    private db: Database.Database,
    private identity: IdentityEngine,
    private emotion?: EmotionEngine,
    private config?: MetroidConfig,
  ) {
    this.stmts = this.prepareStatements();
  }

  // === Callback setters ===

  setOnPostFn(fn: (agentId: string, post: SocialPost) => void): void { this.onPostFn = fn; }
  setOnReactionFn(fn: (postId: string, reaction: SocialReaction) => void): void { this.onReactionFn = fn; }
  setGenerateCommentFn(fn: (agentId: string, prompt: string) => Promise<string>): void { this.generateCommentFn = fn; }

  private prepareStatements() {
    return {
      // --- Layer 0: Relationships ---
      getRelationships: this.db.prepare(`
        SELECT * FROM relationships
        WHERE agent_a = ? OR agent_b = ?
        ORDER BY affinity DESC
      `),
      getRelationship: this.db.prepare(`
        SELECT * FROM relationships
        WHERE (agent_a = ? AND agent_b = ?) OR (agent_a = ? AND agent_b = ?)
        LIMIT 1
      `),
      upsertRelationship: this.db.prepare(`
        INSERT INTO relationships (id, agent_a, agent_b, type, affinity, notes, interaction_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          affinity = excluded.affinity,
          notes = excluded.notes,
          interaction_count = excluded.interaction_count,
          updated_at = datetime('now')
      `),
      incrementInteraction: this.db.prepare(`
        UPDATE relationships SET interaction_count = interaction_count + 1, updated_at = datetime('now')
        WHERE id = ?
      `),
      updateAffinity: this.db.prepare(`
        UPDATE relationships SET affinity = ?, updated_at = datetime('now') WHERE id = ?
      `),

      // --- V8: Posts ---
      insertPost: this.db.prepare(`
        INSERT INTO social_posts (id, agent_id, author_type, content, images, source_type, source_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getRecentPosts: this.db.prepare(`
        SELECT * FROM social_posts ORDER BY created_at DESC LIMIT ?
      `),
      getAgentPosts: this.db.prepare(`
        SELECT * FROM social_posts WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      getPost: this.db.prepare(`
        SELECT * FROM social_posts WHERE id = ?
      `),
      countRecentPosts: this.db.prepare(`
        SELECT COUNT(*) as cnt FROM social_posts
        WHERE agent_id = ? AND created_at > datetime('now', '-1 day')
      `),

      // --- V8: Reactions ---
      insertReaction: this.db.prepare(`
        INSERT INTO social_reactions (id, post_id, actor_id, actor_type, reaction_type, content, reply_to)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getPostReactions: this.db.prepare(`
        SELECT * FROM social_reactions WHERE post_id = ? ORDER BY created_at ASC
      `),
      countPostComments: this.db.prepare(`
        SELECT COUNT(*) as cnt FROM social_reactions WHERE post_id = ? AND reaction_type = 'comment'
      `),
      hasLiked: this.db.prepare(`
        SELECT 1 FROM social_reactions WHERE post_id = ? AND actor_id = ? AND reaction_type = 'like' LIMIT 1
      `),

      // --- V8: Quota ---
      getQuota: this.db.prepare(`
        SELECT * FROM social_daily_quota WHERE agent_id = ? AND date = ?
      `),
      upsertQuota: this.db.prepare(`
        INSERT INTO social_daily_quota (agent_id, date, posts_made, comments_made, connections_used)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, date) DO UPDATE SET
          posts_made = excluded.posts_made,
          comments_made = excluded.comments_made,
          connections_used = excluded.connections_used
      `),

      // --- V8: socialCredit ---
      getCredit: this.db.prepare(`
        SELECT * FROM social_credit WHERE agent_id = ?
      `),
      upsertCredit: this.db.prepare(`
        INSERT INTO social_credit (agent_id, credit, total_posts, total_human_likes, total_human_comments, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id) DO UPDATE SET
          credit = excluded.credit,
          total_posts = excluded.total_posts,
          total_human_likes = excluded.total_human_likes,
          total_human_comments = excluded.total_human_comments,
          updated_at = datetime('now')
      `),

      // --- V8: Bonds ---
      getBond: this.db.prepare(`
        SELECT * FROM agent_bonds WHERE agent_id = ? AND target_id = ?
      `),
      upsertBond: this.db.prepare(`
        INSERT INTO agent_bonds (agent_id, target_id, familiarity, affinity, interaction_count, last_interaction)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id, target_id) DO UPDATE SET
          familiarity = excluded.familiarity,
          affinity = excluded.affinity,
          interaction_count = excluded.interaction_count,
          last_interaction = datetime('now')
      `),

      // --- V8: Credit calculation helpers ---
      getRecentPostsForCredit: this.db.prepare(`
        SELECT p.id,
          (SELECT COUNT(*) FROM social_reactions r WHERE r.post_id = p.id AND r.actor_type = 'user' AND r.reaction_type = 'like') as human_likes,
          (SELECT COUNT(*) FROM social_reactions r WHERE r.post_id = p.id AND r.actor_type = 'user' AND r.reaction_type = 'comment') as human_comments
        FROM social_posts p
        WHERE p.agent_id = ? AND p.author_type = 'agent'
        ORDER BY p.created_at DESC LIMIT 10
      `),
    };
  }

  // =============================================
  // Layer 0: Relationship tracking (preserved)
  // =============================================

  getRelationships(agentId: string): Relationship[] {
    const rows = this.stmts.getRelationships.all(agentId, agentId) as any[];
    return rows.map(this.rowToRelationship);
  }

  getRelationship(agentA: string, agentB: string): Relationship | undefined {
    const row = this.stmts.getRelationship.get(agentA, agentB, agentB, agentA) as any;
    return row ? this.rowToRelationship(row) : undefined;
  }

  setRelationship(agentA: string, agentB: string, type: RelationshipType, affinity: number, notes?: string): Relationship {
    const existing = this.getRelationship(agentA, agentB);
    const id = existing?.id ?? randomUUID();
    const interactionCount = existing?.interactionCount ?? 0;
    this.stmts.upsertRelationship.run(
      id, agentA, agentB, type,
      Math.max(-1, Math.min(1, affinity)),
      notes ?? existing?.notes ?? null,
      interactionCount,
    );
    return this.getRelationship(agentA, agentB)!;
  }

  // =============================================
  // V8: Social Posts (朋友圈)
  // =============================================

  /** Create a social post. Checks daily quota. */
  createPost(
    agentId: string, content: string, sourceType: SocialPostSourceType,
    sourceId?: string, images?: string[], visibility: SocialPostVisibility = 'all',
  ): SocialPost | null {
    const authorType: SocialActorType = sourceType === 'user' ? 'user' : 'agent';

    // Quota check for agents
    if (authorType === 'agent') {
      const quota = this.checkQuota(agentId);
      if (!quota.canPost) return null;
      // Privacy filter
      content = this.privacyFilter(content);
    }

    const id = `post-${randomUUID().slice(0, 8)}`;
    this.stmts.insertPost.run(
      id, agentId, authorType, content,
      images ? JSON.stringify(images) : null,
      sourceType, sourceId ?? null, visibility,
    );

    // Update quota
    if (authorType === 'agent') {
      this.incrementQuota(agentId, 'post');
    }

    // Update credit counters
    const credit = this.getCredit(agentId);
    this.stmts.upsertCredit.run(
      agentId, credit.credit, credit.totalPosts + 1,
      credit.totalHumanLikes, credit.totalHumanComments,
    );

    const post = this.rowToPost(this.stmts.getPost.get(id) as any);
    if (post && this.onPostFn) {
      try { this.onPostFn(agentId, post); } catch { }
    }
    return post;
  }

  /** Get mixed feed of all posts */
  getFeed(limit = 20): SocialPost[] {
    const rows = this.stmts.getRecentPosts.all(Math.min(50, limit)) as any[];
    return rows.map(this.rowToPost);
  }

  /** Get single agent's posts */
  getAgentFeed(agentId: string, limit = 20): SocialPost[] {
    const rows = this.stmts.getAgentPosts.all(agentId, Math.min(50, limit)) as any[];
    return rows.map(this.rowToPost);
  }

  /** Get a single post by ID */
  getPost(postId: string): SocialPost | null {
    const row = this.stmts.getPost.get(postId) as any;
    return row ? this.rowToPost(row) : null;
  }

  // =============================================
  // V8: Reactions (likes + comments)
  // =============================================

  /** Add a reaction (like or comment) to a post */
  addReaction(
    postId: string, actorId: string, actorType: SocialActorType,
    reactionType: SocialReactionType, content?: string, replyTo?: string,
  ): SocialReaction | null {
    // Prevent duplicate likes
    if (reactionType === 'like' && this.stmts.hasLiked.get(postId, actorId)) {
      return null;
    }

    // Comment depth limit: max 2 rounds
    if (reactionType === 'comment' && replyTo) {
      const parentReaction = (this.stmts.getPostReactions.all(postId) as any[])
        .find(r => r.id === replyTo);
      if (parentReaction?.reply_to) return null; // already a reply — no deeper
    }

    const id = `react-${randomUUID().slice(0, 8)}`;
    this.stmts.insertReaction.run(
      id, postId, actorId, actorType, reactionType,
      content ?? null, replyTo ?? null,
    );

    // Human interaction → update socialCredit
    if (actorType === 'user') {
      const post = this.stmts.getPost.get(postId) as any;
      if (post && post.author_type === 'agent') {
        this.updateCreditFromHumanInteraction(post.agent_id, reactionType);
      }
      // Emotion nudge for receiving interaction
      if (post && this.emotion) {
        const delta = reactionType === 'like'
          ? { pleasure: 0.1, arousal: 0, dominance: 0 }
          : { pleasure: 0.15, arousal: 0.05, dominance: 0 };
        (this.emotion as any).nudge?.(post.agent_id, delta, 'social');
      }
    }

    // Update comment quota for agent commenters
    if (actorType === 'agent' && reactionType === 'comment') {
      this.incrementQuota(actorId, 'comment');
    }

    const reaction = this.rowToReaction(
      (this.stmts.getPostReactions.all(postId) as any[]).find(r => r.id === id),
    );
    if (reaction && this.onReactionFn) {
      try { this.onReactionFn(postId, reaction); } catch { }
    }
    return reaction;
  }

  /** Get all reactions for a post */
  getPostReactions(postId: string): SocialReaction[] {
    const rows = this.stmts.getPostReactions.all(postId) as any[];
    return rows.map(this.rowToReaction);
  }

  // =============================================
  // V8: socialCredit
  // =============================================

  /** Get socialCredit state for an agent */
  getCredit(agentId: string): SocialCreditState {
    const row = this.stmts.getCredit.get(agentId) as any;
    if (!row) {
      return {
        agentId, credit: 0, totalPosts: 0,
        totalHumanLikes: 0, totalHumanComments: 0,
        updatedAt: new Date(),
      };
    }
    return {
      agentId: row.agent_id,
      credit: row.credit,
      totalPosts: row.total_posts,
      totalHumanLikes: row.total_human_likes,
      totalHumanComments: row.total_human_comments,
      updatedAt: new Date(row.updated_at),
    };
  }

  /** Recalculate socialCredit as sliding average of last 10 posts' human engagement */
  recalculateCredit(agentId: string): number {
    const rows = this.stmts.getRecentPostsForCredit.all(agentId) as any[];
    if (rows.length === 0) return 0;

    const totalScore = rows.reduce((sum: number, r: any) => {
      return sum + (r.human_likes * 1) + (r.human_comments * 3);
    }, 0);
    const credit = totalScore / rows.length;

    const current = this.getCredit(agentId);
    this.stmts.upsertCredit.run(
      agentId, credit, current.totalPosts,
      current.totalHumanLikes, current.totalHumanComments,
    );
    return credit;
  }

  /** Map socialCredit to max comments per post */
  getCommentBudget(agentId: string): number {
    const credit = this.getCredit(agentId).credit;
    if (credit <= 0) return 0;
    if (credit < 1.0) return 1;
    if (credit < 3.0) return 2;
    return 3;
  }

  private updateCreditFromHumanInteraction(agentId: string, type: SocialReactionType): void {
    const current = this.getCredit(agentId);
    const likes = current.totalHumanLikes + (type === 'like' ? 1 : 0);
    const comments = current.totalHumanComments + (type === 'comment' ? 1 : 0);
    this.stmts.upsertCredit.run(agentId, current.credit, current.totalPosts, likes, comments);
    // Recalculate sliding average
    this.recalculateCredit(agentId);
  }

  // =============================================
  // V8: Daily Quota
  // =============================================

  /** Check if agent can still post/comment today */
  checkQuota(agentId: string): { canPost: boolean; canComment: boolean; postsRemaining: number } {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.stmts.getQuota.get(agentId, today) as any;
    const postsMade = row?.posts_made ?? 0;
    const commentsMade = row?.comments_made ?? 0;
    const maxPosts = 3;
    const maxComments = 8;
    return {
      canPost: postsMade < maxPosts,
      canComment: commentsMade < maxComments,
      postsRemaining: Math.max(0, maxPosts - postsMade),
    };
  }

  private incrementQuota(agentId: string, type: 'post' | 'comment'): void {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.stmts.getQuota.get(agentId, today) as any;
    const posts = (row?.posts_made ?? 0) + (type === 'post' ? 1 : 0);
    const comments = (row?.comments_made ?? 0) + (type === 'comment' ? 1 : 0);
    const connections = row?.connections_used ?? '[]';
    this.stmts.upsertQuota.run(agentId, today, posts, comments, connections);
  }

  // =============================================
  // V8: Social Tick (called from ProactiveEngine)
  // =============================================

  /** Called on each proactive tick — may generate a social event post */
  async socialTick(agentId: string, behavioralState: BehavioralState, emotionState: EmotionState): Promise<void> {
    // V10: Check for neglected posts regardless of other gates
    this.checkLowInteractionPosts(agentId);

    const agent = this.identity.getAgent(agentId);
    if (!agent?.card.social?.connections?.length) return;

    // Behavioral gate
    if (behavioralState === 'withdrawn' || behavioralState === 'cold_war') return;

    // Quota gate
    const quota = this.checkQuota(agentId);
    if (!quota.canPost) return;

    // Frequency probability gate
    const freq = agent.card.social.postFrequency ?? 'normal';
    const probability = freq === 'high' ? 0.15 : freq === 'low' ? 0.03 : 0.08;
    if (Math.random() > probability) return;

    // Select a connection to interact with
    const connection = this.selectConnectionForEvent(agentId, agent.card.social.connections);
    if (!connection || !this.generateCommentFn) return;

    // Generate social event post via LLM
    const activity = connection.activities[Math.floor(Math.random() * connection.activities.length)] ?? '见面';
    const prompt = `你是${agent.card.name}。你刚${activity}了${connection.relation}${connection.name}。
背景：${connection.sharedContext}
请写一条简短的朋友圈动态（50字以内），配上图片描述（1-2张）。
语气要自然，像真人发朋友圈一样。不要太正式。
仅返回JSON：{"content":"文案","images":["图片描述1"]}`;

    try {
      const raw = await this.generateCommentFn(agentId, prompt);
      const parsed = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      const post = this.createPost(
        agentId, parsed.content ?? raw.slice(0, 100),
        'social', connection.id,
        Array.isArray(parsed.images) ? parsed.images : undefined,
      );
      if (post) {
        // Record bond interaction
        this.stmts.upsertBond.run(agentId, connection.id, 0.1, 0.1, 1);
        // Generate likes + comments from other agents
        await this.generateLikesForPost(post.id);
        await this.generateCommentsForPost(post.id);
      }
    } catch (err) {
      console.error(`[V8] Social tick post generation failed:`, err);
    }
  }

  /** V10: Check for low-interaction posts and nudge emotion down */
  checkLowInteractionPosts(agentId: string): void {
    if (!this.emotion) return;

    // Find agent posts from 2-4 hours ago with 0 reactions
    const posts = this.stmts.getAgentPosts.all(agentId, 10) as any[];
    const now = Date.now();
    for (const post of posts) {
      if (post.author_type !== 'agent') continue;
      const ageMs = now - new Date(post.created_at).getTime();
      const ageHours = ageMs / 3_600_000;
      if (ageHours < 2 || ageHours > 4) continue;

      const reactions = this.stmts.getPostReactions.all(post.id) as any[];
      if (reactions.length === 0) {
        (this.emotion as any).nudge?.(agentId, { pleasure: -0.05, arousal: 0, dominance: -0.02 }, 'social_neglect');
        break; // Only one nudge per tick
      }
    }
  }

  /** Select a world book connection for social event, weighted by recency and affinity */
  private selectConnectionForEvent(agentId: string, connections: SocialConnection[]): SocialConnection | null {
    if (connections.length === 0) return null;

    // Check which connections were used today
    const today = new Date().toISOString().slice(0, 10);
    const quotaRow = this.stmts.getQuota.get(agentId, today) as any;
    const usedToday: string[] = JSON.parse(quotaRow?.connections_used ?? '[]');
    const maxConnectionsPerDay = 2;
    if (usedToday.length >= maxConnectionsPerDay) return null;

    // Filter out already-used connections
    const available = connections.filter(c => !usedToday.includes(c.id));
    if (available.length === 0) return null;

    // Weighted random: prefer connections not recently interacted with
    const weights = available.map(c => {
      const bond = this.stmts.getBond.get(agentId, c.id) as any;
      const daysSince = bond?.last_interaction
        ? (Date.now() - new Date(bond.last_interaction).getTime()) / 86400000
        : 30; // never interacted = high weight
      return 1 / (daysSince + 1) + (bond?.affinity ?? 0.1);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < available.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        // Record connection usage
        usedToday.push(available[i].id);
        this.stmts.upsertQuota.run(
          agentId, today,
          quotaRow?.posts_made ?? 0, quotaRow?.comments_made ?? 0,
          JSON.stringify(usedToday),
        );
        return available[i];
      }
    }
    return available[0];
  }

  // =============================================
  // V8: Comment & Like Generation
  // =============================================

  /** Generate AI likes for a post (pure rules, zero LLM) */
  async generateLikesForPost(postId: string): Promise<void> {
    const post = this.stmts.getPost.get(postId) as any;
    if (!post) return;

    const allAgents = this.identity.getAllAgents();
    for (const agent of allAgents) {
      if (agent.id === post.agent_id) continue;

      // Probability based on relationship + personality
      const rel = this.getRelationship(agent.id, post.agent_id);
      const affinity = rel?.affinity ?? 0;
      const expressiveness = agent.card.emotion?.expressiveness ?? 0.5;
      const prob = Math.max(0, affinity * 0.5 + expressiveness * 0.3);
      if (Math.random() < prob) {
        this.addReaction(postId, agent.id, 'agent', 'like');
      }
    }
  }

  /** Generate AI comments for a post (LLM, budget-controlled) */
  async generateCommentsForPost(postId: string): Promise<void> {
    const post = this.stmts.getPost.get(postId) as any;
    if (!post || !this.generateCommentFn) return;

    const budget = this.getCommentBudget(post.agent_id);
    if (budget <= 0) return;

    // Select potential commenters
    const allAgents = this.identity.getAllAgents();
    const candidates: Array<{ agentId: string; score: number; personality?: string }> = [];

    for (const agent of allAgents) {
      if (agent.id === post.agent_id) continue;
      const rel = this.getRelationship(agent.id, post.agent_id);
      const affinity = rel?.affinity ?? 0;
      const expressiveness = agent.card.emotion?.expressiveness ?? 0.5;
      const score = affinity * 0.6 + expressiveness * 0.4;
      if (score > 0.1) {
        candidates.push({
          agentId: agent.id,
          score,
          personality: agent.card.social?.commentStyle ?? agent.card.personality?.slice(0, 50),
        });
      }
    }

    // Sort by score, take top N
    candidates.sort((a, b) => b.score - a.score);
    const commenters = candidates.slice(0, budget);

    for (const commenter of commenters) {
      const commenterAgent = this.identity.getAgent(commenter.agentId);
      if (!commenterAgent) continue;

      // Check commenter's quota
      const quota = this.checkQuota(commenter.agentId);
      if (!quota.canComment) continue;

      const prompt = `你是${commenterAgent.card.name}。${commenter.personality ? `性格：${commenter.personality}` : ''}
你看到了朋友的朋友圈：
"${post.content}"
这是公开的朋友圈，注意分寸，不要透露私密信息。
请写一条简短评论（30字以内），保持你的性格。仅返回评论文本，不要引号。`;

      try {
        const comment = await this.generateCommentFn(commenter.agentId, prompt);
        if (comment && comment.trim().length > 0) {
          this.addReaction(postId, commenter.agentId, 'agent', 'comment', comment.trim());
        }
      } catch (err) {
        console.error(`[V8] Comment generation failed for ${commenter.agentId}:`, err);
      }
    }
  }

  // =============================================
  // V8: Monologue → Post Bridge
  // =============================================

  /** Called when a monologue qualifies for social posting */
  onMonologueForSocial(
    agentId: string, content: string, trigger: string, monologueId: string,
    emotionState?: EmotionState,
  ): void {
    // Determine source type (emotion peak takes priority)
    let sourceType: SocialPostSourceType;
    if (emotionState && (emotionState.pleasure > 0.7 || emotionState.pleasure < -0.5)) sourceType = 'emotion_peak';
    else if (trigger === 'event_detected') sourceType = 'event';
    else if (trigger === 'state_change') sourceType = 'conversation';
    else sourceType = 'ambient';

    const post = this.createPost(agentId, content, sourceType, monologueId);
    if (post) {
      // Async: generate likes and comments
      this.generateLikesForPost(post.id).catch(() => {});
      this.generateCommentsForPost(post.id).catch(() => {});
    }
  }

  // =============================================
  // V8: Privacy Filter
  // =============================================

  private privacyFilter(content: string): string {
    let filtered = content;
    // Replace user name patterns with generic references
    filtered = filtered.replace(/用户\s*[\u4e00-\u9fff\w]+/g, '有人');
    filtered = filtered.replace(/(跟|和|与)\s*[\u4e00-\u9fff]{2,4}\s*(聊|说|谈|讨论)/g, '$1朋友$2');
    filtered = filtered.replace(/@[\w]+/g, '');
    return filtered.trim();
  }

  // =============================================
  // Engine Interface
  // =============================================

  /** Inject relationship + social context into prompts */
  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    if (context.mode === 'classic') return [];

    const relationships = this.getRelationships(context.agentId);
    const parts: string[] = [];

    // Layer 0: Relationship context
    if (relationships.length > 0) {
      const lines = relationships.map(r => {
        const otherId = r.agentA === context.agentId ? r.agentB : r.agentA;
        const other = this.identity.getAgent(otherId);
        const name = other?.name ?? otherId;
        const affinityDesc = r.affinity > 0.5 ? '亲密' : r.affinity > 0 ? '友好' : r.affinity > -0.5 ? '一般' : '疏远';
        return `- ${name}: ${r.type} (${affinityDesc}${r.notes ? `, ${r.notes}` : ''})`;
      });
      parts.push('<relationships>', '你与其他角色的关系：', ...lines, '</relationships>');
    }

    // V8: Recent social activity
    const recentPosts = this.getAgentFeed(context.agentId, 3);
    if (recentPosts.length > 0) {
      const socialLines = recentPosts.map(p => {
        const reactions = this.stmts.getPostReactions.all(p.id) as any[];
        const likeCount = reactions.filter((r: any) => r.reaction_type === 'like').length;
        const commentCount = reactions.filter((r: any) => r.reaction_type === 'comment').length;
        return `- "${p.content.slice(0, 40)}${p.content.length > 40 ? '...' : ''}" (${likeCount}赞, ${commentCount}评论)`;
      });
      parts.push('<recent_social>', '你最近的朋友圈：', ...socialLines, '</recent_social>');
    }

    if (parts.length === 0) return [];

    const content = parts.join('\n');
    return [{
      source: 'social',
      content,
      priority: 35,
      tokens: Math.ceil(content.length / 3),
      required: false,
    }];
  }

  /** After response: detect mentions of other agents and update affinity */
  async onResponse(response: string, context: EngineContext): Promise<void> {
    const allAgents = this.identity.getAllAgents();
    const currentAgent = context.agentId;

    for (const agent of allAgents) {
      if (agent.id === currentAgent) continue;

      const mentioned = context.message.content.includes(agent.name) ||
                        response.includes(agent.name);
      if (!mentioned) continue;

      let rel = this.getRelationship(currentAgent, agent.id);
      if (!rel) {
        rel = this.setRelationship(currentAgent, agent.id, 'acquaintance', 0.1);
      }

      this.stmts.incrementInteraction.run(rel.id);
      const newAffinity = Math.min(1, rel.affinity + 0.02);
      this.stmts.updateAffinity.run(newAffinity, rel.id);
    }
  }

  fallback(): PromptFragment[] {
    return [];
  }

  // =============================================
  // Row converters
  // =============================================

  private rowToRelationship(row: any): Relationship {
    return {
      id: row.id,
      agentA: row.agent_a,
      agentB: row.agent_b,
      type: row.type as RelationshipType,
      affinity: row.affinity,
      notes: row.notes ?? undefined,
      interactionCount: row.interaction_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private rowToPost(row: any): SocialPost {
    return {
      id: row.id,
      agentId: row.agent_id,
      authorType: row.author_type as SocialActorType,
      content: row.content,
      images: row.images ? JSON.parse(row.images) : undefined,
      sourceType: row.source_type as SocialPostSourceType,
      sourceId: row.source_id ?? undefined,
      visibility: row.visibility as SocialPostVisibility,
      createdAt: new Date(row.created_at),
    };
  }

  private rowToReaction(row: any): SocialReaction {
    return {
      id: row.id,
      postId: row.post_id,
      actorId: row.actor_id,
      actorType: row.actor_type as SocialActorType,
      reactionType: row.reaction_type as SocialReactionType,
      content: row.content ?? undefined,
      replyTo: row.reply_to ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
