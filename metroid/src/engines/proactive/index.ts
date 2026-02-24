import type Database from 'better-sqlite3';
import type { MetroidConfig } from '../../config.js';
import type { IdentityEngine } from '../identity/index.js';
import type { EmotionEngine } from '../emotion/index.js';
import type { AuditLog } from '../../security/audit.js';
import { EmbeddingService } from '../memory/embedding.js';
import type {
  Engine, EngineContext, PromptFragment,
  ProactiveTrigger, ProactiveTriggerType, ProactiveMessage,
  EmotionState, ImpulseState, ImpulseSignal, ActiveEvent,
  AgentIdentity, BehavioralEnvelope, BehavioralState, MessagePattern, MessagePlan,
  UserRelationship, MonologueTrigger,
} from '../../types.js';

/** Timestamped emotion snapshot for ring buffer */
interface EmotionSnapshot {
  time: number;
  state: EmotionState;
}

const EMOTION_HISTORY_MAX = 60; // keep ~60 snapshots (1 per check interval)

// Conversation event detection keywords (bilingual)
const EVENT_PATTERNS: Array<{ pattern: RegExp; event: string; intensity: number; relevance: number; llmVerify: boolean }> = [
  { pattern: /再见|告别|离开|出国|分别|farewell|goodbye|leaving/i, event: 'farewell', intensity: 0.8, relevance: 0.9, llmVerify: true },
  { pattern: /吵架|生气|讨厌你|不理你|conflict|angry|hate/i, event: 'conflict', intensity: 0.7, relevance: 0.8, llmVerify: true },
  { pattern: /想你|好久不见|miss you|missed you/i, event: 'longing', intensity: 0.6, relevance: 0.9, llmVerify: false },
  { pattern: /孤独|寂寞|一个人|lonely|alone/i, event: 'loneliness', intensity: 0.5, relevance: 0.7, llmVerify: true },
  { pattern: /生日|纪念日|birthday|anniversary/i, event: 'celebration', intensity: 0.7, relevance: 0.8, llmVerify: false },
  { pattern: /难过|伤心|哭|sad|crying|tears/i, event: 'distress', intensity: 0.6, relevance: 0.8, llmVerify: true },
  { pattern: /喜欢你|爱你|love you|like you|表白|confession/i, event: 'intimacy', intensity: 0.8, relevance: 1.0, llmVerify: true },
  // V3: new patterns
  { pattern: /烦死了|受不了|frustrat|annoyed|irritat/i, event: 'frustration', intensity: 0.6, relevance: 0.7, llmVerify: true },
  { pattern: /太棒了|好开心|兴奋|excited|amazing|awesome/i, event: 'excitement', intensity: 0.7, relevance: 0.8, llmVerify: false },
  { pattern: /谢谢|感谢|感恩|thank|grateful/i, event: 'gratitude', intensity: 0.5, relevance: 0.6, llmVerify: true },
  { pattern: /对不起|抱歉|sorry|apologize/i, event: 'apology', intensity: 0.5, relevance: 0.7, llmVerify: true },
  { pattern: /焦虑|担心|害怕|anxious|worried|scared/i, event: 'anxiety', intensity: 0.6, relevance: 0.8, llmVerify: true },
  { pattern: /怀念|以前|那时候|nostalg|remember when/i, event: 'nostalgia', intensity: 0.5, relevance: 0.7, llmVerify: true },
];

/**
 * Proactive Engine — enables agents to initiate messages autonomously.
 *
 * Trigger types:
 *   cron     — fires at scheduled times (simplified: "HH:MM" daily)
 *   idle     — fires after N minutes of user silence
 *   emotion  — fires on emotion delta-rate or sustained-state conditions:
 *              delta:axis<threshold/windowMin     (rate of change)
 *              sustained:axis<threshold/windowMin  (held for duration)
 *              axis<threshold                      (legacy instant check)
 *   event    — fires on named events (birthday, etc.) — manual trigger via API
 *
 * Generated messages are queued in proactive_messages table.
 * The HTTP adapter exposes GET /agents/:id/proactive/pending for delivery.
 */
export class ProactiveEngine implements Engine {
  name = 'proactive';

  private stmts: ReturnType<typeof this.prepareStatements>;
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private lastActivity = new Map<string, number>(); // agentId → timestamp
  private lastFired = new Map<string, number>(); // "agentId:triggerIdx" → timestamp
  private emotionHistory = new Map<string, EmotionSnapshot[]>(); // agentId → ring buffer
  private impulseStates = new Map<string, ImpulseState>(); // agentId → impulse accumulator

  // === Dedup (V3) ===
  private embedding: EmbeddingService;
  private messageEmbeddingCache = new Map<string, Float32Array>(); // messageId → embedding

  // === V4: Spark embedding cache ===
  private sparkEmbeddingCache = new Map<string, Float32Array>(); // spark keyword → embedding

  // === V5: Envelope disable flag (for A/B testing) ===
  private envelopeDisabled = new Set<string>(); // agentIds with envelope disabled

  // === V6: Relationship & Inner Life ===
  private lastBehavioralState = new Map<string, BehavioralState>(); // agentId → last known state
  private tickCount = new Map<string, number>(); // agentId → tick counter for ambient monologue
  /** Callback notified when an inner monologue is generated (for WS push) */
  private onMonologueFn?: (agentId: string, data: { id: string; trigger: string; content: string; createdAt: number }) => void;

  // === Feedback loop (V3) ===
  /** Callback for lightweight LLM analysis (event detection) */
  private analyzeFn?: (prompt: string) => Promise<string>;

  /** Injectable clock — returns epoch ms. Override via setDebugClock() for testing. */
  private clockFn: () => number = () => Date.now();
  private debugTimeOffset = 0; // ms offset added to real time in debug mode

  /** Callback set by Metroid class to generate proactive messages via LLM */
  private generateFn?: (agentId: string, triggerPrompt: string) => Promise<string>;
  /** Callback notified when a proactive message is generated (for WS push) */
  private onMessageFn?: (agentId: string, msg: ProactiveMessage) => void;

  constructor(
    private db: Database.Database,
    private identity: IdentityEngine,
    private emotion: EmotionEngine,
    private audit: AuditLog,
    private config: MetroidConfig,
  ) {
    this.embedding = new EmbeddingService(config);
    this.stmts = this.prepareStatements();
  }

  /** Get current time (respects debug offset) */
  private now(): number {
    return this.clockFn() + this.debugTimeOffset;
  }

  /** Get current Date (respects debug offset) */
  private nowDate(): Date {
    return new Date(this.now());
  }

  /** Advance debug clock by N minutes (additive) */
  advanceTime(minutes: number): void {
    this.debugTimeOffset += minutes * 60_000;
    console.log(`[Debug] Clock advanced by ${minutes}m (total offset: ${(this.debugTimeOffset / 60_000).toFixed(1)}m)`);
  }

  /** Reset debug clock to real time */
  resetClock(): void {
    this.debugTimeOffset = 0;
    console.log(`[Debug] Clock reset to real time`);
  }

  /** Get current debug time offset in minutes */
  getTimeOffset(): number {
    return this.debugTimeOffset / 60_000;
  }

  private prepareStatements() {
    return {
      insertMessage: this.db.prepare(`
        INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content)
        VALUES (?, ?, ?, ?, ?)
      `),
      getPending: this.db.prepare(`
        SELECT * FROM proactive_messages
        WHERE agent_id = ? AND delivered = 0
        ORDER BY created_at ASC LIMIT ?
      `),
      markDelivered: this.db.prepare(`
        UPDATE proactive_messages SET delivered = 1, delivered_at = datetime('now') WHERE id = ?
      `),
      countPending: this.db.prepare(`
        SELECT COUNT(*) as cnt FROM proactive_messages
        WHERE agent_id = ? AND delivered = 0
      `),
      getLongTermMood: this.db.prepare(`
        SELECT dimension, value FROM long_term_mood WHERE agent_id = ?
      `),
      upsertLongTermMood: this.db.prepare(`
        INSERT INTO long_term_mood (agent_id, dimension, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id, dimension) DO UPDATE SET
          value = excluded.value, updated_at = excluded.updated_at
      `),
      // V3: dedup — recent delivered messages
      getRecentDelivered: this.db.prepare(`
        SELECT id, content FROM proactive_messages
        WHERE agent_id = ? AND delivered = 1
        AND created_at > datetime('now', '-30 minutes')
        ORDER BY created_at DESC LIMIT 10
      `),
      // V3: feedback loop
      insertReaction: this.db.prepare(`
        INSERT INTO proactive_reactions (agent_id, message_id, reaction, response_latency_ms, conversation_turns)
        VALUES (?, ?, ?, ?, ?)
      `),
      getUnreactedDelivered: this.db.prepare(`
        SELECT pm.id, pm.delivered_at FROM proactive_messages pm
        WHERE pm.agent_id = ? AND pm.delivered = 1 AND pm.delivered_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM proactive_reactions pr WHERE pr.message_id = pm.id)
        ORDER BY pm.delivered_at DESC LIMIT 1
      `),
      getStaleDelivered: this.db.prepare(`
        SELECT pm.id FROM proactive_messages pm
        WHERE pm.agent_id = ? AND pm.delivered = 1 AND pm.delivered_at IS NOT NULL
        AND pm.delivered_at < datetime('now', '-30 minutes')
        AND NOT EXISTS (SELECT 1 FROM proactive_reactions pr WHERE pr.message_id = pm.id)
      `),
      getPreference: this.db.prepare(`
        SELECT value FROM proactive_preferences WHERE agent_id = ? AND key = ?
      `),
      upsertPreference: this.db.prepare(`
        INSERT INTO proactive_preferences (agent_id, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id, key) DO UPDATE SET
          value = excluded.value, updated_at = excluded.updated_at
      `),
      getReactionStats: this.db.prepare(`
        SELECT
          pm.trigger_type,
          pr.reaction,
          COUNT(*) as cnt
        FROM proactive_reactions pr
        JOIN proactive_messages pm ON pm.id = pr.message_id
        WHERE pr.agent_id = ?
        AND pr.created_at > datetime('now', '-7 days')
        GROUP BY pm.trigger_type, pr.reaction
      `),
      countReactionsSince: this.db.prepare(`
        SELECT COUNT(*) as cnt FROM proactive_reactions
        WHERE agent_id = ? AND created_at > datetime('now', '-7 days')
      `),
      // V5: count specific reaction type in last 24h
      countRecentReactions: this.db.prepare(`
        SELECT COUNT(*) as cnt FROM proactive_reactions
        WHERE agent_id = ? AND reaction = ? AND created_at > datetime('now', '-1 day')
      `),
      // V6: relationship
      getRelationship: this.db.prepare(`SELECT * FROM user_relationships WHERE agent_id = ? AND user_id = ?`),
      upsertRelationship: this.db.prepare(`
        INSERT INTO user_relationships (agent_id, user_id, attachment, trust, familiarity, last_interaction, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(agent_id, user_id) DO UPDATE SET
          attachment = excluded.attachment, trust = excluded.trust,
          familiarity = excluded.familiarity, last_interaction = datetime('now'),
          updated_at = datetime('now')
      `),
      // V6: inner monologue
      insertMonologue: this.db.prepare(`
        INSERT INTO inner_monologues (id, agent_id, user_id, trigger, content, emotion_snapshot)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getRecentMonologues: this.db.prepare(`
        SELECT * FROM inner_monologues WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      getUnconsumedDrafts: this.db.prepare(`
        SELECT * FROM inner_monologues
        WHERE agent_id = ? AND user_id = ? AND trigger = 'message_suppressed'
        AND content NOT LIKE '%[consumed]%'
        ORDER BY created_at DESC LIMIT 3
      `),
      markDraftConsumed: this.db.prepare(`
        UPDATE inner_monologues SET content = content || ' [consumed]' WHERE id = ?
      `),
    };
  }

  /** Set the LLM generation callback (called from Metroid class) */
  setGenerateFn(fn: (agentId: string, triggerPrompt: string) => Promise<string>): void {
    this.generateFn = fn;
  }

  /** Set callback for when a proactive message is generated (for WS push) */
  setOnMessageFn(fn: (agentId: string, msg: ProactiveMessage) => void): void {
    this.onMessageFn = fn;
  }

  /** Set lightweight LLM analysis callback (for event detection) */
  setAnalyzeFn(fn: (prompt: string) => Promise<string>): void {
    this.analyzeFn = fn;
  }

  /** V6: Set callback for inner monologue notifications (for WS push) */
  setOnMonologueFn(fn: (agentId: string, data: { id: string; trigger: string; content: string; createdAt: number }) => void): void {
    this.onMonologueFn = fn;
  }

  /** V6: Get per-user relationship state */
  getRelationship(agentId: string, userId: string): UserRelationship {
    const row = this.stmts.getRelationship.get(agentId, userId) as any;
    if (row) {
      return {
        agentId, userId,
        attachment: row.attachment, trust: row.trust, familiarity: row.familiarity,
        lastInteraction: new Date(row.last_interaction).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };
    }
    return { agentId, userId, attachment: 0, trust: 0, familiarity: 0, lastInteraction: this.now(), updatedAt: this.now() };
  }

  /** V6: Update relationship via LLM analysis */
  private async updateRelationshipViaLLM(agentId: string, userId: string, messageContent: string, agentResponse: string): Promise<void> {
    if (!this.analyzeFn) return;
    const agent = this.identity.getAgent(agentId);
    const current = this.getRelationship(agentId, userId);
    const prompt = `分析这段对话对关系的影响。
当前关系: attachment=${current.attachment.toFixed(2)}, trust=${current.trust.toFixed(2)}
用户说: "${messageContent.slice(0, 200)}"
角色回复: "${agentResponse.slice(0, 200)}"
请以JSON回复: {"attachment_delta": -0.1~0.1, "trust_delta": -0.1~0.1, "reason": "简短原因"}`;

    try {
      const raw = await this.analyzeFn(prompt);
      const parsed = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      const volatility = agent?.card.relationship?.relationshipVolatility ?? 0.3;
      const newAttachment = clamp(current.attachment + (parsed.attachment_delta ?? 0) * volatility, -1, 1);
      const newTrust = clamp(current.trust + (parsed.trust_delta ?? 0) * volatility, -1, 1);
      const newFamiliarity = Math.min(1, current.familiarity + 0.01);
      this.stmts.upsertRelationship.run(agentId, userId, newAttachment, newTrust, newFamiliarity);
    } catch (err) {
      console.error(`[V6] Failed to update relationship via LLM:`, err);
    }
  }

  /** V6: Generate inner monologue */
  private async generateInnerMonologue(
    agentId: string, userId: string | undefined,
    trigger: MonologueTrigger, context: string
  ): Promise<string | null> {
    if (!this.analyzeFn) return null;
    const agent = this.identity.getAgent(agentId);
    const recentMonologues = this.stmts.getRecentMonologues.all(agentId, 3) as any[];
    const prompt = `你是${agent?.card.name ?? '角色'}。基于以下情境，写一句内心独白（20-50字，第一人称，不要引号）。
情境: ${context}
${recentMonologues.length > 0 ? `最近的想法: ${recentMonologues.map((m: any) => m.content).join(' / ')}` : ''}`;

    try {
      const content = await this.analyzeFn(prompt);
      if (!content || content.length < 2) return null;

      const id = `mono-${agentId}-${this.now()}`;
      const emotionSnapshot = JSON.stringify(this.emotion.getState(agentId));
      this.stmts.insertMonologue.run(id, agentId, userId ?? null, trigger, content.trim(), emotionSnapshot);

      if (this.onMonologueFn) {
        try { this.onMonologueFn(agentId, { id, trigger, content: content.trim(), createdAt: this.now() }); } catch { }
      }
      return content.trim();
    } catch (err) {
      console.error(`[V6] Failed to generate inner monologue:`, err);
      return null;
    }
  }

  /** V6: Get recent inner monologues */
  getRecentMonologues(agentId: string, limit = 10): any[] {
    return this.stmts.getRecentMonologues.all(agentId, limit) as any[];
  }

  /** Record user activity (called on each chat message) */
  recordActivity(agentId: string): void {
    this.lastActivity.set(agentId, this.now());
  }

  /** Start background trigger evaluation for an agent */
  start(agentId: string): void {
    if (this.timers.has(agentId)) return;
    const agent = this.identity.getAgent(agentId);
    if (!agent || agent.mode === 'classic') return;
    if (!agent.card.proactive?.enabled) return;

    this.lastActivity.set(agentId, this.now());
    this.emotionHistory.set(agentId, []);
    this.recordEmotionSnapshot(agentId); // initial snapshot
    this.initImpulseState(agentId);
    const interval = this.config.proactive.checkIntervalMs;

    const timer = setInterval(() => {
      this.recordEmotionSnapshot(agentId);
      this.evaluateAll(agentId).catch(err =>
        console.error(`[Proactive] Evaluation failed for ${agentId}:`, err)
      );
    }, interval);

    this.timers.set(agentId, timer);
    console.log(`[Proactive] Started for ${agent.name} (${agent.card.proactive.triggers.length} triggers, check every ${interval / 1000}s)`);
  }

  /** Stop background evaluation */
  stop(agentId?: string): void {
    if (agentId) {
      this.updateLongTermMood(agentId); // persist long-term mood on session end
      const timer = this.timers.get(agentId);
      if (timer) { clearInterval(timer); this.timers.delete(agentId); }
      this.emotionHistory.delete(agentId);
      this.impulseStates.delete(agentId);
    } else {
      for (const [id, timer] of this.timers) {
        this.updateLongTermMood(id);
        clearInterval(timer);
      }
      this.timers.clear();
      this.emotionHistory.clear();
      this.impulseStates.clear();
    }
  }

  // ============================================================
  // V3: Message Deduplication
  // ============================================================

  /** Check if content is semantically duplicate of pending + recent delivered messages */
  async isDuplicate(agentId: string, content: string): Promise<boolean> {
    // Gather comparison targets: pending + recent delivered
    const pending = this.stmts.getPending.all(agentId, 20) as Array<{ id: string; content: string }>;
    const delivered = this.stmts.getRecentDelivered.all(agentId) as Array<{ id: string; content: string }>;
    const targets = [...pending, ...delivered];
    if (targets.length === 0) return false;

    // Try embedding-based comparison first
    const contentEmb = await this.embedding.embed(content);
    if (contentEmb) {
      for (const t of targets) {
        let targetEmb = this.messageEmbeddingCache.get(t.id);
        if (!targetEmb) {
          const emb = await this.embedding.embed(t.content);
          if (emb) {
            targetEmb = emb;
            this.messageEmbeddingCache.set(t.id, emb);
          }
        }
        if (targetEmb) {
          const sim = EmbeddingService.cosineSimilarity(contentEmb, targetEmb);
          if (sim > 0.85) {
            console.log(`[Dedup] Skipping duplicate (cosine=${sim.toFixed(3)}) for ${agentId}`);
            return true;
          }
        }
      }
      return false;
    }

    // Fallback: bigram Jaccard similarity
    for (const t of targets) {
      const sim = bigramJaccard(content, t.content);
      if (sim > 0.7) {
        console.log(`[Dedup] Skipping duplicate (jaccard=${sim.toFixed(3)}) for ${agentId}`);
        return true;
      }
    }
    return false;
  }

  /** Clean stale entries from embedding cache (messages older than 1 hour) */
  private cleanEmbeddingCache(): void {
    // Simple strategy: if cache exceeds 100 entries, clear oldest half
    if (this.messageEmbeddingCache.size > 100) {
      const keys = [...this.messageEmbeddingCache.keys()];
      for (let i = 0; i < keys.length / 2; i++) {
        this.messageEmbeddingCache.delete(keys[i]);
      }
    }
  }

  // ============================================================
  // V3: User Feedback Loop
  // ============================================================

  /** Record user reaction to a proactive message */
  recordReaction(agentId: string, messageId: string, reaction: 'engaged' | 'ignored' | 'dismissed', latencyMs?: number, turns?: number): void {
    this.stmts.insertReaction.run(agentId, messageId, reaction, latencyMs ?? null, turns ?? null);
  }

  /** Detect reaction from user response — called in onResponse() */
  private detectReaction(agentId: string): void {
    const row = this.stmts.getUnreactedDelivered.get(agentId) as { id: string; delivered_at: string } | undefined;
    if (!row || !row.delivered_at) return;

    const deliveredAt = new Date(row.delivered_at + 'Z').getTime();
    const now = this.now();
    const latencyMs = now - deliveredAt;

    // If within 30 minutes, user engaged
    if (latencyMs <= 30 * 60_000) {
      this.recordReaction(agentId, row.id, 'engaged', latencyMs);
      // V4: Self-action feedback — positive response
      const state = this.impulseStates.get(agentId);
      if (state?.awaitingResponse && state.awaitingMessageId === row.id) {
        const responseIntensity = Math.max(0.2, 0.6 * (1 - latencyMs / (30 * 60_000)));
        this.addActiveEvent(agentId, 'response_positive', responseIntensity, 0.4, 0.7);
        state.awaitingResponse = false;
        state.awaitingMessageId = undefined;
      }
      this.maybeUpdatePreferences(agentId);
    }
  }

  /** Mark stale delivered messages as ignored (called in evaluateAll) */
  private markStaleAsIgnored(agentId: string): void {
    const rows = this.stmts.getStaleDelivered.all(agentId) as Array<{ id: string }>;
    for (const r of rows) {
      this.recordReaction(agentId, r.id, 'ignored');
      // V4: Self-action feedback — message was ignored
      const state = this.impulseStates.get(agentId);
      if (state?.awaitingResponse && state.awaitingMessageId === r.id) {
        this.addActiveEvent(agentId, 'message_ignored', 0.4, 0.3, 0.6);
        state.awaitingResponse = false;
        state.awaitingMessageId = undefined;
      }
    }
    if (rows.length > 0) this.maybeUpdatePreferences(agentId);
  }

  /** Get adaptive fire threshold for an agent */
  getAdaptiveThreshold(agentId: string): number | null {
    const row = this.stmts.getPreference.get(agentId, 'fire_threshold') as { value: number } | undefined;
    return row?.value ?? null;
  }

  /** Get a preference value */
  getPreference(agentId: string, key: string): number | null {
    const row = this.stmts.getPreference.get(agentId, key) as { value: number } | undefined;
    return row?.value ?? null;
  }

  /** Maybe update preferences if enough reactions accumulated */
  private maybeUpdatePreferences(agentId: string): void {
    const countRow = this.stmts.countReactionsSince.get(agentId) as { cnt: number };
    if (countRow.cnt < 10) return; // need at least 10 reactions
    // Only recalculate every 10 reactions
    if (countRow.cnt % 10 !== 0) return;
    this.updatePreferences(agentId);
  }

  /** Recalculate signal weights and fire threshold based on reaction history */
  updatePreferences(agentId: string): void {
    const stats = this.stmts.getReactionStats.all(agentId) as Array<{ trigger_type: string; reaction: string; cnt: number }>;
    if (stats.length === 0) return;

    // Group by trigger_type
    const byType = new Map<string, { engaged: number; total: number }>();
    for (const s of stats) {
      const entry = byType.get(s.trigger_type) ?? { engaged: 0, total: 0 };
      entry.total += s.cnt;
      if (s.reaction === 'engaged') entry.engaged += s.cnt;
      byType.set(s.trigger_type, entry);
    }

    // Compute overall engaged rate for threshold adjustment
    let totalEngaged = 0, totalAll = 0;
    for (const [, v] of byType) {
      totalEngaged += v.engaged;
      totalAll += v.total;
    }
    const overallRate = totalAll > 0 ? totalEngaged / totalAll : 0.5;

    // Adjust fire threshold: low engagement → raise threshold, high → lower
    const agent = this.identity.getAgent(agentId);
    const baseThreshold = agent?.card.proactive?.impulse?.fireThreshold ?? this.config.proactive.impulseFireThreshold;
    let newThreshold = baseThreshold;
    if (overallRate < 0.3) newThreshold = Math.min(0.95, baseThreshold * 1.15);
    else if (overallRate > 0.7) newThreshold = Math.max(0.3, baseThreshold * 0.9);
    this.stmts.upsertPreference.run(agentId, 'fire_threshold', newThreshold);

    // Adjust per-type weights
    for (const [triggerType, data] of byType) {
      const rate = data.total > 0 ? data.engaged / data.total : 0.5;
      let multiplier = 1;
      if (rate < 0.3) multiplier = 0.8;
      else if (rate > 0.7) multiplier = 1.1;
      this.stmts.upsertPreference.run(agentId, `weight:${triggerType}`, multiplier);
    }
  }

  /** Evaluate all triggers for an agent */
  private async evaluateTriggers(agentId: string): Promise<void> {
    const agent = this.identity.getAgent(agentId);
    if (!agent?.card.proactive?.enabled) return;

    const triggers = agent.card.proactive.triggers;
    const now = this.now();
    const pendingCount = (this.stmts.countPending.get(agentId) as any)?.cnt ?? 0;
    if (pendingCount >= this.config.proactive.maxPendingMessages) return;

    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      const key = `${agentId}:${i}`;
      const cooldown = (trigger.cooldownMinutes ?? this.config.proactive.defaultCooldownMinutes) * 60_000;
      const lastFiredAt = this.lastFired.get(key) ?? 0;

      if (now - lastFiredAt < cooldown) continue;

      let shouldFire = false;

      switch (trigger.type) {
        case 'cron':
          shouldFire = this.evaluateCron(trigger.condition);
          break;
        case 'idle':
          shouldFire = this.evaluateIdle(agentId, trigger.condition);
          break;
        case 'emotion':
          shouldFire = this.evaluateEmotion(agentId, trigger.condition);
          break;
        case 'event':
          // Events are triggered externally via API, not by the scheduler
          break;
      }

      if (shouldFire) {
        await this.fireTrigger(agentId, i, trigger);
        this.lastFired.set(key, now);
      }
    }
  }

  /** Simple cron: "HH:MM" daily match (within the check interval window) */
  private evaluateCron(condition: string): boolean {
    const match = condition.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;
    const targetH = parseInt(match[1]);
    const targetM = parseInt(match[2]);
    const now = this.nowDate();
    const windowMs = this.config.proactive.checkIntervalMs;
    const nowMs = now.getHours() * 3600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1000;
    const targetMs = targetH * 3600_000 + targetM * 60_000;
    return Math.abs(nowMs - targetMs) < windowMs;
  }

  /** Idle trigger: fires after N minutes of no user activity */
  private evaluateIdle(agentId: string, condition: string): boolean {
    const minutes = parseInt(condition);
    if (isNaN(minutes)) return false;
    const lastActive = this.lastActivity.get(agentId) ?? this.now();
    return (this.now() - lastActive) > minutes * 60_000;
  }

  /** Record an emotion snapshot into the ring buffer */
  private recordEmotionSnapshot(agentId: string): void {
    const state = this.emotion.getState(agentId);
    if (!state) return;
    const buf = this.emotionHistory.get(agentId) ?? [];
    buf.push({ time: this.now(), state: { ...state } });
    if (buf.length > EMOTION_HISTORY_MAX) buf.shift();
    this.emotionHistory.set(agentId, buf);
  }

  /** Compute emotion trajectory over a time window */
  computeTrajectory(agentId: string, windowMs = 2 * 3_600_000): Record<string, { direction: 'rising' | 'falling' | 'stable'; delta: number; durationMin: number }> {
    const buf = this.emotionHistory.get(agentId);
    const result: Record<string, { direction: 'rising' | 'falling' | 'stable'; delta: number; durationMin: number }> = {};
    const axes: Array<keyof EmotionState> = ['pleasure', 'arousal', 'dominance'];

    if (!buf || buf.length < 2) {
      for (const axis of axes) result[axis] = { direction: 'stable', delta: 0, durationMin: 0 };
      return result;
    }

    const now = this.now();
    const windowStart = now - windowMs;
    const inWindow = buf.filter(s => s.time >= windowStart);
    if (inWindow.length < 2) {
      for (const axis of axes) result[axis] = { direction: 'stable', delta: 0, durationMin: 0 };
      return result;
    }

    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const durationMin = (last.time - first.time) / 60_000;

    for (const axis of axes) {
      const delta = last.state[axis] - first.state[axis];
      const direction = delta > 0.05 ? 'rising' : delta < -0.05 ? 'falling' : 'stable';
      result[axis] = { direction, delta, durationMin };
    }
    return result;
  }

  /**
   * Emotion trigger — supports 3 condition formats:
   *   delta:axis<threshold/windowMin     — rate of change over window
   *   sustained:axis<threshold/windowMin — held below/above for duration
   *   axis<threshold                     — legacy instant check (discouraged)
   */
  private evaluateEmotion(agentId: string, condition: string): boolean {
    if (condition.startsWith('delta:')) {
      return this.evaluateEmotionDelta(agentId, condition.slice(6));
    }
    if (condition.startsWith('sustained:')) {
      return this.evaluateEmotionSustained(agentId, condition.slice(10));
    }
    // Legacy: instant threshold check
    return this.evaluateEmotionLegacy(agentId, condition);
  }

  /** delta:pleasure<-0.3/30m — "pleasure dropped by 0.3+ in the last 30 minutes" */
  private evaluateEmotionDelta(agentId: string, expr: string): boolean {
    const parsed = this.parseEmotionExpr(expr);
    if (!parsed) return false;
    const { axis, op, threshold, windowMs } = parsed;

    const buf = this.emotionHistory.get(agentId);
    if (!buf || buf.length < 2) return false;

    const now = this.now();
    const current = buf[buf.length - 1];

    // Find the oldest snapshot within the window
    const windowStart = now - windowMs;
    const baseline = buf.find(s => s.time >= windowStart) ?? buf[0];
    if (baseline === current) return false;

    const delta = current.state[axis] - baseline.state[axis];
    return op === '<' ? delta < threshold : delta > threshold;
  }

  /** sustained:pleasure<-0.3/20m — "pleasure has been below -0.3 for 20+ continuous minutes" */
  private evaluateEmotionSustained(agentId: string, expr: string): boolean {
    const parsed = this.parseEmotionExpr(expr);
    if (!parsed) return false;
    const { axis, op, threshold, windowMs } = parsed;

    const buf = this.emotionHistory.get(agentId);
    if (!buf || buf.length < 2) return false;

    const now = this.now();
    const windowStart = now - windowMs;
    const inWindow = buf.filter(s => s.time >= windowStart);

    // Need at least 2 snapshots in the window to be meaningful
    if (inWindow.length < 2) return false;

    // ALL snapshots in the window must satisfy the condition
    return inWindow.every(s =>
      op === '<' ? s.state[axis] < threshold : s.state[axis] > threshold
    );
  }

  /** Parse "axis<threshold/windowMin" → { axis, op, threshold, windowMs } */
  private parseEmotionExpr(expr: string): {
    axis: keyof EmotionState; op: string; threshold: number; windowMs: number;
  } | null {
    const match = expr.match(
      /^(pleasure|arousal|dominance)\s*([<>])\s*(-?[\d.]+)\s*\/\s*(\d+)m$/
    );
    if (!match) return null;
    return {
      axis: match[1] as keyof EmotionState,
      op: match[2],
      threshold: parseFloat(match[3]),
      windowMs: parseInt(match[4]) * 60_000,
    };
  }

  /** Legacy instant threshold check (e.g. "pleasure<-0.5") */
  private evaluateEmotionLegacy(agentId: string, condition: string): boolean {
    const state = this.emotion.getState(agentId);
    if (!state) return false;
    const match = condition.match(/^(pleasure|arousal|dominance)\s*([<>])\s*(-?[\d.]+)$/);
    if (!match) return false;
    const axis = match[1] as keyof EmotionState;
    const op = match[2];
    const threshold = parseFloat(match[3]);
    const value = state[axis];
    return op === '<' ? value < threshold : value > threshold;
  }

  // ============================================================
  // Impulse Accumulator — continuous "urge to speak" model
  // ============================================================

  /** Evaluate both legacy triggers and impulse system (public for debug tick) */
  async evaluateAll(agentId: string): Promise<void> {
    this.recordEmotionSnapshot(agentId); // ensure manual ticks also record snapshots
    this.markStaleAsIgnored(agentId); // V3: mark stale messages as ignored
    this.cleanEmbeddingCache(); // V3: clean dedup cache
    await this.evaluateTriggers(agentId);
    const agent = this.identity.getAgent(agentId);
    if (agent?.card.proactive?.impulse?.enabled) {
      await this.evaluateImpulse(agentId, agent);
    }
  }

  /** Initialize impulse state for an agent */
  private initImpulseState(agentId: string): void {
    if (!this.impulseStates.has(agentId)) {
      this.impulseStates.set(agentId, {
        value: 0,
        lastDecayTime: this.now(),
        lastFireTime: 0,
        activeEvents: [],
        suppressionCount: 0,
        memoryPressure: 0,
        lastMemoryPressureTime: this.now(),
        awaitingResponse: false,
        inbox: [],
        conversationTempo: 0,  // V6
      });
    }
  }

  /** Inject an event into the impulse system (from API or conversation detection) */
  addActiveEvent(agentId: string, name: string, intensity: number, decayRate = 0.5, relevance = 0.8, confidence = 1.0): void {
    const state = this.impulseStates.get(agentId);
    if (!state) return;
    // V4: Cognitive Filter — apply per-agent event sensitivity
    const agent = this.identity.getAgent(agentId);
    const sensitivity = agent?.card.emotion?.eventSensitivity?.[name] ?? 1.0;
    intensity = Math.min(1, intensity * sensitivity);
    const now = this.now();
    // Don't duplicate — refresh intensity if same event exists
    const existing = state.activeEvents.find(e => e.name === name);
    if (existing) {
      // Event cooldown: if same event within 10 minutes, reduce new intensity by 50%
      const minutesSince = (now - existing.createdAt) / 60_000;
      const effectiveIntensity = minutesSince < 10 ? intensity * 0.5 : intensity;
      existing.intensity = Math.max(existing.intensity, effectiveIntensity);
      existing.relevance = Math.max(existing.relevance, relevance);
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.createdAt = now;
    } else {
      state.activeEvents.push({ name, intensity, relevance, confidence, createdAt: now, decayRate });
    }
    console.log(`[Impulse] Event '${name}' (intensity=${intensity}, relevance=${relevance}) added for ${agentId}`);
  }

  /** Get current impulse state (for debug endpoint) */
  getImpulseState(agentId: string): ImpulseState | undefined {
    return this.impulseStates.get(agentId);
  }

  /** Get long-term mood from DB */
  getLongTermMood(agentId: string): Record<string, number> {
    const rows = this.stmts.getLongTermMood.all(agentId) as Array<{ dimension: string; value: number }>;
    const result: Record<string, number> = {};
    for (const r of rows) result[r.dimension] = r.value;
    return result;
  }

  /** Update long-term mood via EMA (called on session end) */
  updateLongTermMood(agentId: string): void {
    const agent = this.identity.getAgent(agentId);
    if (!agent) return;
    const dimensions = agent.card.emotion?.longTermDimensions ?? ['attachment', 'trust'];
    const moodInertia = agent.card.emotion?.moodInertia ?? 0.9;
    const alpha = 1 - moodInertia;

    const buf = this.emotionHistory.get(agentId);
    if (!buf || buf.length === 0) return;

    // Compute session average PAD
    const avg = { pleasure: 0, arousal: 0, dominance: 0 };
    for (const snap of buf) {
      avg.pleasure += snap.state.pleasure;
      avg.arousal += snap.state.arousal;
      avg.dominance += snap.state.dominance;
    }
    avg.pleasure /= buf.length;
    avg.arousal /= buf.length;
    avg.dominance /= buf.length;

    // Map dimensions to PAD axes (simple heuristic)
    const dimToValue = (dim: string): number => {
      switch (dim) {
        case 'attachment': return (avg.pleasure + avg.arousal) / 2;
        case 'trust': return (avg.pleasure + avg.dominance) / 2;
        default: console.warn(`[LongTermMood] Unknown dimension '${dim}', falling back to pleasure`); return avg.pleasure;
      }
    };

    const current = this.getLongTermMood(agentId);
    for (const dim of dimensions) {
      const sessionVal = dimToValue(dim);
      const oldVal = current[dim] ?? 0;
      const newVal = alpha * sessionVal + (1 - alpha) * oldVal;
      this.stmts.upsertLongTermMood.run(agentId, dim, newVal);
    }
  }

  /** Core impulse evaluation — called every check interval */
  private async evaluateImpulse(agentId: string, agent: AgentIdentity): Promise<void> {
    const impulseConfig = agent.card.proactive?.impulse;
    if (!impulseConfig?.enabled) return;

    const state = this.impulseStates.get(agentId);
    if (!state) return;

    const now = this.now();
    const dtHours = (now - state.lastDecayTime) / 3_600_000;
    state.lastDecayTime = now;

    const emotionCfg = agent.card.emotion;
    const restraint = emotionCfg?.restraint ?? 0.3;
    const expressiveness = emotionCfg?.expressiveness ?? 0.5;

    // V4: Update memory pressure (leaky integrator)
    const pressureDt = (now - state.lastMemoryPressureTime) / 3_600_000;
    state.lastMemoryPressureTime = now;
    const currentEmotion = this.emotion.getState(agentId);
    const baseline = emotionCfg?.baseline ?? { pleasure: 0, arousal: 0, dominance: 0 };
    if (currentEmotion) {
      const emotionDist = Math.sqrt(
        (currentEmotion.pleasure - baseline.pleasure) ** 2 +
        (currentEmotion.arousal - baseline.arousal) ** 2 +
        (currentEmotion.dominance - baseline.dominance) ** 2
      );
      const pressureDecay = impulseConfig.memoryPressureDecayRate ?? 0.02;
      state.memoryPressure += emotionDist * pressureDt - pressureDecay * pressureDt;
      state.memoryPressure = Math.max(0, Math.min(2, state.memoryPressure));
    }

    // 1. Decay active events
    for (let i = state.activeEvents.length - 1; i >= 0; i--) {
      const e = state.activeEvents[i];
      const eventHours = (now - e.createdAt) / 3_600_000;
      e.intensity *= Math.exp(-e.decayRate * eventHours);
      if (e.intensity < 0.05) state.activeEvents.splice(i, 1);
    }

    // 2. Compute event gate (max intensity × relevance × confidence of active events)
    const eventGate = state.activeEvents.length > 0
      ? Math.max(...state.activeEvents.map(e => e.intensity * e.relevance * (e.confidence ?? 1)))
      : 0;

    // 3. Compute gain from all signals
    let totalGain = 0;
    for (const signal of impulseConfig.signals) {
      const activation = this.computeSignalActivation(agentId, signal);
      // emotion_pattern signals require event gate; idle/time bypass it
      const gate = signal.type === 'emotion_pattern' ? eventGate : 1;
      totalGain += signal.weight * activation * gate;
    }

    // 4. Compute decay
    const decayRate = impulseConfig.decayRate ?? this.config.proactive.impulseDecayRate;
    const totalDecay = decayRate * dtHours * (1 + restraint);

    // 5. Update impulse
    state.value = Math.max(0, Math.min(1, state.value + totalGain * dtHours - totalDecay));

    // 6. Check firing
    const baseFireThreshold = impulseConfig.fireThreshold ?? this.config.proactive.impulseFireThreshold;
    const fireThreshold = this.getAdaptiveThreshold(agentId) ?? baseFireThreshold;
    const cooldownMs = (impulseConfig.cooldownMinutes ?? this.config.proactive.impulseCooldownMinutes) * 60_000;
    const cooldownElapsed = (now - state.lastFireTime) > cooldownMs;
    const pendingCount = (this.stmts.countPending.get(agentId) as any)?.cnt ?? 0;

    if (state.value >= fireThreshold && cooldownElapsed && pendingCount < this.config.proactive.maxPendingMessages) {
      const suppressionBonus = Math.min(0.2, state.suppressionCount * 0.05);
      const dynamicThreshold = fireThreshold + restraint * 0.3 - suppressionBonus;
      const fireProbability = sigmoid(10 * expressiveness * (state.value - dynamicThreshold));

      if (Math.random() < fireProbability) {
        // FIRE
        await this.fireImpulse(agentId, agent, state);
        state.value = 0.2; // residual impulse
        state.suppressionCount = 0;
        state.lastFireTime = now;
      } else {
        // SUPPRESS
        state.suppressionCount++;
        console.log(`[Impulse] Suppressed for ${agent.name} (impulse=${state.value.toFixed(3)}, threshold=${dynamicThreshold.toFixed(3)}, p=${fireProbability.toFixed(3)}, suppressions=${state.suppressionCount})`);
        // V6: Generate unsent draft monologue
        const envelope = this.evaluateBehavioralState(agentId, agent);
        this.generateInnerMonologue(agentId, undefined, 'message_suppressed',
          `想说但忍住了。当前状态: ${envelope.state}，情绪基调: ${envelope.emotionalTone || '平静'}`);
      }
    }

    // V4: Inspiration spark evaluation
    await this.evaluateSpark(agentId, agent, state);

    // V6: Ambient monologue (every 10 ticks when there's emotional pressure)
    const tc = (this.tickCount.get(agentId) ?? 0) + 1;
    this.tickCount.set(agentId, tc);
    if (state.memoryPressure > 0.2 && tc % 10 === 0) {
      const lastActive = this.lastActivity.get(agentId) ?? this.now();
      const idleMin = Math.round((this.now() - lastActive) / 60_000);
      this.generateInnerMonologue(agentId, undefined, 'ambient',
        `沉默了${idleMin}分钟，情绪积压${(state.memoryPressure * 100).toFixed(0)}%`);
    }
  }

  /** Compute activation for a single signal */
  private computeSignalActivation(agentId: string, signal: ImpulseSignal): number {
    switch (signal.type) {
      case 'emotion_pattern':
        return this.computeEmotionPatternActivation(agentId, signal);
      case 'idle':
        return this.computeIdleActivation(agentId, signal.idleMinutes ?? 60);
      case 'time_of_day':
        return this.computeTimeActivation(signal.timeRange);
      case 'emotion_pressure':
        return this.computeEmotionPressureActivation(agentId);
      case 'memory_breach':
        return this.computeMemoryBreachActivation(agentId);
      default:
        return 0;
    }
  }

  /** Compute emotion pressure: distance from baseline (not gated by events) */
  private computeEmotionPressureActivation(agentId: string): number {
    const state = this.emotion.getState(agentId);
    if (!state) return 0;
    const agent = this.identity.getAgent(agentId);
    const baseline = agent?.card.emotion?.baseline ?? { pleasure: 0, arousal: 0, dominance: 0 };
    const dist = Math.sqrt(
      (state.pleasure - baseline.pleasure) ** 2 +
      (state.arousal - baseline.arousal) ** 2 +
      (state.dominance - baseline.dominance) ** 2
    );
    return Math.min(1, dist / 1.0); // saturates early: dist=1 → full activation (intentionally sensitive)
  }

  /** V4: Memory breach activation — smooth ramp when pressure exceeds threshold */
  private computeMemoryBreachActivation(agentId: string): number {
    const state = this.impulseStates.get(agentId);
    if (!state) return 0;
    const agent = this.identity.getAgent(agentId);
    const threshold = agent?.card.proactive?.impulse?.memoryBreachThreshold ?? 0.7;
    if (state.memoryPressure < threshold) return 0;
    return Math.min(1, (state.memoryPressure - threshold) / threshold);
  }

  /** V4: Inspiration spark — random thematic seed × prepared mind = eureka */
  private async evaluateSpark(agentId: string, agent: AgentIdentity, state: ImpulseState): Promise<void> {
    const impulseConfig = agent.card.proactive?.impulse;
    const pool = impulseConfig?.sparkPool;
    if (!pool || pool.length === 0) return;

    // Compute dynamic probability with bonuses
    const baseProbability = impulseConfig?.sparkProbability ?? 0.08;
    const lastActive = this.lastActivity.get(agentId) ?? this.now();
    const idleHours = (this.now() - lastActive) / 3_600_000;
    const idleBonus = Math.min(0.1, idleHours * 0.05);
    const currentEmotion = this.emotion.getState(agentId);
    const baseline = agent.card.emotion?.baseline ?? { pleasure: 0, arousal: 0, dominance: 0 };
    let emotionBonus = 0;
    if (currentEmotion) {
      const dist = Math.sqrt(
        (currentEmotion.pleasure - baseline.pleasure) ** 2 +
        (currentEmotion.arousal - baseline.arousal) ** 2 +
        (currentEmotion.dominance - baseline.dominance) ** 2
      );
      emotionBonus = Math.min(0.08, dist * 0.08);
    }
    const pressureBonus = Math.min(0.05, state.memoryPressure * 0.05);
    const probability = Math.min(0.3, baseProbability + idleBonus + emotionBonus + pressureBonus);

    if (Math.random() >= probability) return;

    // Pick random spark
    const spark = pool[Math.floor(Math.random() * pool.length)];

    // Compute resonance
    let resonance = 0;
    const resonanceThreshold = impulseConfig?.sparkResonanceThreshold ?? 0.4;

    // Semantic similarity with active events
    if (state.activeEvents.length > 0) {
      let sparkEmb = this.sparkEmbeddingCache.get(spark);
      if (!sparkEmb) {
        const emb = await this.embedding.embed(spark);
        if (emb) { sparkEmb = emb; this.sparkEmbeddingCache.set(spark, emb); }
      }
      if (sparkEmb) {
        let maxSim = 0;
        for (const e of state.activeEvents) {
          const eventEmb = await this.embedding.embed(e.name);
          if (eventEmb) {
            const sim = EmbeddingService.cosineSimilarity(sparkEmb, eventEmb) * e.intensity;
            maxSim = Math.max(maxSim, sim);
          }
        }
        resonance += maxSim;
      }
    }

    // Late-night bonus
    const hour = this.nowDate().getHours();
    if (hour >= 22 || hour < 5) resonance += 0.2;

    // Memory pressure alignment
    if (state.memoryPressure > 0.3) resonance += state.memoryPressure * 0.2;

    resonance = Math.min(1, resonance);

    if (resonance >= resonanceThreshold) {
      const intensity = 0.4 + 0.4 * resonance; // 0.4-0.8 based on resonance
      this.addActiveEvent(agentId, `inspiration:${spark}`, intensity, 0.3, 0.9);
      console.log(`[Spark] '${spark}' resonated (${resonance.toFixed(2)}) for ${agent.name}`);
    }
  }

  // ============================================================
  // V5: Behavioral Envelope
  // ============================================================

  /** Disable/enable envelope for an agent (for A/B testing V4 vs V5) */
  setEnvelopeDisabled(agentId: string, disabled: boolean): void {
    if (disabled) this.envelopeDisabled.add(agentId);
    else this.envelopeDisabled.delete(agentId);
  }

  isEnvelopeDisabled(agentId: string): boolean {
    return this.envelopeDisabled.has(agentId);
  }

  /** Inject an active event directly (for testing — bypasses card trigger matching) */
  injectActiveEvent(agentId: string, eventName: string, intensity = 0.8, decayRate = 0.5, relevance = 0.8): void {
    this.addActiveEvent(agentId, eventName, intensity, decayRate, relevance);
  }

  /** Count specific reaction type in last 24h */
  getRecentReactionCount(agentId: string, reaction: string): number {
    const row = this.stmts.countRecentReactions.get(agentId, reaction) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /** Evaluate behavioral state from V4 signals — deterministic, zero LLM calls */
  evaluateBehavioralState(agentId: string, agent: AgentIdentity, userId?: string): BehavioralEnvelope {
    const state = this.impulseStates.get(agentId);
    const emotionCfg = agent.card.emotion;
    const expressiveness = emotionCfg?.expressiveness ?? 0.5;
    const restraint = emotionCfg?.restraint ?? 0.3;
    const resilience = emotionCfg?.resilience ?? 0.5;

    // Compute emotion distance from baseline
    const currentEmotion = this.emotion.getState(agentId);
    const baseline = emotionCfg?.baseline ?? { pleasure: 0, arousal: 0, dominance: 0 };
    const emotionDist = currentEmotion ? Math.sqrt(
      (currentEmotion.pleasure - baseline.pleasure) ** 2 +
      (currentEmotion.arousal - baseline.arousal) ** 2 +
      (currentEmotion.dominance - baseline.dominance) ** 2
    ) : 0;

    const memoryPressure = state?.memoryPressure ?? 0;
    const impulseValue = state?.value ?? 0;
    const awaitingResponse = state?.awaitingResponse ?? false;
    const activeEvents = state?.activeEvents ?? [];

    const ignoredCount = this.getRecentReactionCount(agentId, 'ignored');
    const engagedCount = this.getRecentReactionCount(agentId, 'engaged');

    const lastActive = this.lastActivity.get(agentId) ?? this.now();
    const idleMinutes = (this.now() - lastActive) / 60_000;

    // V6: Relationship modulation
    const relationship = userId ? this.getRelationship(agentId, userId) : null;
    const attachmentEffect = agent.card.relationship?.attachmentEffect ?? {};
    const att = relationship?.attachment ?? 0;
    const thresholdShift = att * (attachmentEffect.thresholdShift ?? 0.1);
    const toleranceBonus = Math.floor(att * (attachmentEffect.toleranceBonus ?? 2));

    // Character behavioral overrides
    const behavioralCfg = agent.card.behavioral;
    const overrides = behavioralCfg?.stateOverrides;

    // State determination (priority high → low)
    let envelope: BehavioralEnvelope;

    // 1. cold_war: high-intensity negative event + high emotionDist + restraint
    // V6: higher attachment = harder to trigger cold_war (threshold shifts up)
    const hasNegativeEvent = activeEvents.some(e =>
      (e.name === 'conflict' || e.name === 'distress') && e.intensity > 0.6
    );
    if (hasNegativeEvent && emotionDist > (0.8 + thresholdShift) && restraint > 0.4) {
      envelope = {
        state: 'cold_war',
        responseMode: Math.random() < 0.8 ? 'silent' : 'reluctant',
        messagePattern: 'minimal',
        replyProbability: 0.15 + resilience * 0.2,
        delayRange: [300_000, 1_800_000], // 5-30min
        maxMessages: 1,
        emotionalTone: '你很生气/受伤，选择沉默。如果回复，用最少的字。',
        suppressFollowUp: true,
      };
    }
    // 2. withdrawn: ignored >= 3 + pressure, or message_ignored event
    // V6: higher attachment = more ignores tolerated
    else if (
      (ignoredCount >= (3 + toleranceBonus) && memoryPressure > 0.3) ||
      activeEvents.some(e => e.name === 'message_ignored' && e.intensity > 0.3)
    ) {
      const delayBase: [number, number] = [120_000, 900_000]; // 2-15min
      const delayMul = 1 + ignoredCount * 0.3;
      envelope = {
        state: 'withdrawn',
        responseMode: 'reluctant',
        messagePattern: memoryPressure > 0.6 ? 'minimal' : 'single',
        replyProbability: 0.5 + expressiveness * 0.3,
        delayRange: [delayBase[0] * delayMul, delayBase[1] * delayMul],
        maxMessages: 1,
        emotionalTone: resilience > 0.5
          ? '有点失落但还是想聊'
          : '不太想说话，怕又被忽略',
        suppressFollowUp: true,
      };
    }
    // 3. clingy: high impulse + active emotion + no ignores + expressive
    // V6: higher attachment = easier to be clingy (threshold shifts down)
    else if (impulseValue > (0.5 - thresholdShift) && emotionDist > 0.3 && ignoredCount === 0 && expressiveness > 0.5) {
      envelope = {
        state: 'clingy',
        responseMode: 'eager',
        messagePattern: Math.random() < 0.5 ? 'burst' : 'fragmented',
        replyProbability: 1.0,
        delayRange: [0, 3000], // 0-3s
        maxMessages: 2 + Math.floor(expressiveness * 2), // 2-4
        emotionalTone: '看到消息很开心，想分享很多事情。',
        suppressFollowUp: false,
      };
    }
    // 4. hesitant: awaiting response or high restraint + some impulse
    else if (awaitingResponse || (restraint > 0.6 && impulseValue > 0.3)) {
      envelope = {
        state: 'hesitant',
        responseMode: 'normal',
        messagePattern: 'single',
        replyProbability: 0.8,
        delayRange: [30_000, 300_000], // 30s-5min
        maxMessages: 1,
        emotionalTone: '想说但在犹豫要不要说',
        suppressFollowUp: true,
      };
    }
    // 5. normal: default
    else {
      envelope = {
        state: 'normal',
        responseMode: 'normal',
        messagePattern: 'single',
        replyProbability: 1.0,
        delayRange: [1000, 10_000], // 1-10s
        maxMessages: 1,
        emotionalTone: '',
        suppressFollowUp: false,
      };
    }

    // Apply character stateOverrides
    if (overrides?.[envelope.state]) {
      const o = overrides[envelope.state]!;
      if (o.emotionalTone) envelope.emotionalTone = o.emotionalTone;
      if (o.replyProbabilityMod != null) {
        envelope.replyProbability = Math.max(0, Math.min(1, envelope.replyProbability + o.replyProbabilityMod));
      }
      if (o.delayMod != null) {
        envelope.delayRange = [envelope.delayRange[0] * o.delayMod, envelope.delayRange[1] * o.delayMod];
      }
      if (o.preferredPattern) envelope.messagePattern = o.preferredPattern;
    }

    // Random perturbation
    envelope.replyProbability = Math.max(0, Math.min(1,
      envelope.replyProbability + (Math.random() - 0.5) * 0.2
    ));
    const delayJitter = 0.8 + Math.random() * 0.4; // 0.8-1.2
    envelope.delayRange = [envelope.delayRange[0] * delayJitter, envelope.delayRange[1] * delayJitter];

    // Append neverDo/alwaysDo to emotionalTone
    if (behavioralCfg?.neverDo?.length) {
      envelope.emotionalTone += (envelope.emotionalTone ? '\n' : '') + `绝对不要: ${behavioralCfg.neverDo.join('、')}`;
    }
    if (behavioralCfg?.alwaysDo?.length) {
      envelope.emotionalTone += (envelope.emotionalTone ? '\n' : '') + `一定要: ${behavioralCfg.alwaysDo.join('、')}`;
    }

    // V6: Detect state change and generate inner monologue
    const prevState = this.lastBehavioralState.get(agentId);
    if (prevState && prevState !== envelope.state) {
      this.generateInnerMonologue(agentId, userId, 'state_change',
        `状态从${prevState}变为${envelope.state}`);
    }
    this.lastBehavioralState.set(agentId, envelope.state);

    // V6: Conversation tempo modulation
    if (state?.conversationTempo && state.conversationTempo > 0) {
      const tempoRatio = state.conversationTempo / 60_000; // normalize to minutes
      const tempoMul = Math.max(0.3, tempoRatio);
      envelope.delayRange = [envelope.delayRange[0] * tempoMul, envelope.delayRange[1] * tempoMul];
    }

    return envelope;
  }

  /** Parse LLM output into MessagePlan */
  private parseMessagePlan(content: string, envelope: BehavioralEnvelope): MessagePlan {
    const msgRegex = /\[MSG\]([\s\S]*?)\[\/MSG\]/g;
    const matches = [...content.matchAll(msgRegex)];

    if (matches.length > 0) {
      const messages = matches
        .slice(0, envelope.maxMessages)
        .map((m, i) => ({
          text: m[1].trim(),
          delayMs: i === 0 ? 0 : this.computeMessageDelay(envelope.messagePattern),
        }))
        .filter(m => m.text.length > 0);
      if (messages.length > 0) return { messages, envelope };
    }

    // Fallback: treat entire content as single message
    return { messages: [{ text: content, delayMs: 0 }], envelope };
  }

  /** Compute inter-message delay based on pattern */
  private computeMessageDelay(pattern: MessagePattern): number {
    switch (pattern) {
      case 'burst': return 1000 + Math.random() * 2000;      // 1-3s
      case 'fragmented': return 3000 + Math.random() * 5000;  // 3-8s
      default: return 0;
    }
  }

  /** Check if all conditions in an emotion pattern are satisfied */
  private computeEmotionPatternActivation(agentId: string, signal: ImpulseSignal): number {
    const pattern = signal.emotionCondition;
    if (!pattern) return 0;

    const state = this.emotion.getState(agentId);
    if (!state) return 0;

    // Check if all conditions are currently met
    const allMet = pattern.conditions.every(c => {
      const val = state[c.axis];
      return c.op === '<' ? val < c.value : val > c.value;
    });

    if (!allMet) return 0;

    // If sustained is required, check the ring buffer
    if (pattern.sustainedMinutes) {
      const buf = this.emotionHistory.get(agentId);
      if (!buf || buf.length < 2) return 0;
      const windowStart = this.now() - pattern.sustainedMinutes * 60_000;
      const inWindow = buf.filter(s => s.time >= windowStart);
      if (inWindow.length < 2) return 0;
      const sustained = inWindow.every(snap =>
        pattern.conditions.every(c => {
          const val = snap.state[c.axis];
          return c.op === '<' ? val < c.value : val > c.value;
        })
      );
      return sustained ? 1 : 0;
    }

    return 1;
  }

  /** Smooth idle activation: smoothstep ramp from 0 to 1 */
  private computeIdleActivation(agentId: string, targetMinutes: number): number {
    const lastActive = this.lastActivity.get(agentId) ?? this.now();
    const idleMinutes = (this.now() - lastActive) / 60_000;
    const x = Math.max(0, Math.min(1, idleMinutes / targetMinutes));
    return x * x * (3 - 2 * x); // smoothstep
  }

  /** Time-of-day activation: 1 if within range, 0 otherwise */
  private computeTimeActivation(range?: { start: string; end: string }): number {
    if (!range) return 0;
    const now = this.nowDate();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = range.start.split(':').map(Number);
    const [eh, em] = range.end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin <= endMin) {
      return (nowMin >= startMin && nowMin <= endMin) ? 1 : 0;
    }
    // Wraps midnight
    return (nowMin >= startMin || nowMin <= endMin) ? 1 : 0;
  }

  /** Detect conversation events from message text */
  private detectConversationEvents(text: string): Array<{ name: string; intensity: number; relevance: number }> {
    const events: Array<{ name: string; intensity: number; relevance: number }> = [];
    for (const { pattern, event, intensity, relevance } of EVENT_PATTERNS) {
      if (pattern.test(text)) {
        events.push({ name: event, intensity, relevance });
      }
    }
    return events;
  }

  // ============================================================
  // V3: Context-Aware Event Detection (LLM)
  // ============================================================

  /** Use LLM to confirm/deny regex candidates and discover new events */
  async detectEventsWithLLM(
    agentId: string,
    text: string,
    regexCandidates: Array<{ name: string; intensity: number; relevance: number }>,
    recentHistory: import('../../types.js').MetroidMessage[] = [],
  ): Promise<Array<{ name: string; intensity: number; relevance: number; confidence: number }>> {
    if (!this.analyzeFn) return regexCandidates.map(e => ({ ...e, confidence: 0.6 }));

    // Only verify events marked for LLM verification
    const needsVerify = regexCandidates.filter(c => {
      const pat = EVENT_PATTERNS.find(p => p.event === c.name);
      return pat?.llmVerify !== false;
    });
    const autoConfirm = regexCandidates.filter(c => {
      const pat = EVENT_PATTERNS.find(p => p.event === c.name);
      return pat?.llmVerify === false;
    }).map(e => ({ ...e, confidence: 0.8 }));

    if (needsVerify.length === 0) return autoConfirm;

    const contextLines = recentHistory.slice(-3).map(m =>
      `${m.author.name}: ${m.content.slice(0, 100)}`
    ).join('\n');

    const candidateList = needsVerify.map(c => c.name).join(', ');

    const prompt = `分析以下对话消息，判断是否包含以下情感事件。

消息: "${text.slice(0, 500)}"
${contextLines ? `上下文:\n${contextLines}\n` : ''}
候选事件: ${candidateList}

请以JSON格式回复（不要markdown代码块）:
{"events":[{"name":"事件名","confirmed":true/false,"intensity":0.0-1.0,"relevance":0.0-1.0,"confidence":0.0-1.0,"reason":"简短原因"}],"new_events":[{"name":"新事件名","intensity":0.0-1.0,"relevance":0.0-1.0,"confidence":0.0-1.0,"reason":"简短原因"}]}`;

    try {
      const raw = await this.analyzeFn(prompt);
      const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned) as {
        events?: Array<{ name: string; confirmed: boolean; intensity: number; relevance: number; confidence: number }>;
        new_events?: Array<{ name: string; intensity: number; relevance: number; confidence: number }>;
      };

      const results: Array<{ name: string; intensity: number; relevance: number; confidence: number }> = [...autoConfirm];

      // Process confirmed events
      if (parsed.events) {
        for (const e of parsed.events) {
          if (e.confirmed && e.confidence >= 0.5) {
            results.push({
              name: e.name,
              intensity: e.intensity ?? 0.5,
              relevance: e.relevance ?? 0.7,
              confidence: e.confidence,
            });
          }
        }
      }

      // Process newly discovered events
      if (parsed.new_events) {
        for (const e of parsed.new_events) {
          if (e.confidence >= 0.5) {
            results.push({
              name: e.name,
              intensity: e.intensity ?? 0.5,
              relevance: e.relevance ?? 0.7,
              confidence: e.confidence,
            });
          }
        }
      }

      console.log(`[EventDetect] LLM confirmed ${results.length} events for ${agentId}`);
      return results;
    } catch (err) {
      console.warn(`[EventDetect] LLM analysis failed, using regex fallback:`, err);
      return regexCandidates.map(e => ({ ...e, confidence: 0.6 }));
    }
  }

  /** Determine dominant trigger type from signal contributions */
  private determineTriggerType(agentId: string, impulseConfig: NonNullable<NonNullable<import('../../types.js').MetroidCard['proactive']>['impulse']>): string {
    const contributions: Record<string, number> = {};
    for (const signal of impulseConfig.signals) {
      const activation = this.computeSignalActivation(agentId, signal);
      const key = signal.type === 'emotion_pattern' || signal.type === 'emotion_pressure' || signal.type === 'memory_breach' ? 'emotion' : signal.type;
      contributions[key] = (contributions[key] ?? 0) + signal.weight * activation;
    }
    const sorted = Object.entries(contributions).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return 'impulse:mixed';
    const top = sorted[0];
    if (sorted.length > 1 && sorted[1][1] > top[1] * 0.5) return 'impulse:mixed';
    if (top[0] === 'idle') return 'impulse:idle';
    if (top[0] === 'emotion') return 'impulse:emotion';
    return 'impulse:mixed';
  }

  /** Format structured internal state XML for LLM prompt */
  private formatInternalState(agentId: string, agent: AgentIdentity, state: ImpulseState): string {
    const trajectory = this.computeTrajectory(agentId);
    const longTermMood = this.getLongTermMood(agentId);
    const lastActive = this.lastActivity.get(agentId) ?? this.now();
    const idleMin = Math.round((this.now() - lastActive) / 60_000);

    const dirLabel = (d: string) => d === 'rising' ? '上升中' : d === 'falling' ? '下降中' : '平稳';

    let xml = '<internal_state>\n  <emotion_trajectory>\n';
    for (const axis of ['pleasure', 'arousal', 'dominance'] as const) {
      const t = trajectory[axis];
      xml += `    ${axis}: ${t.delta >= 0 ? '+' : ''}${t.delta.toFixed(2)} (${dirLabel(t.direction)}`;
      if (t.durationMin > 0) xml += `, 过去${Math.round(t.durationMin)}分钟`;
      xml += ')\n';
    }
    xml += '  </emotion_trajectory>\n';

    if (Object.keys(longTermMood).length > 0) {
      xml += '  <long_term_mood>\n';
      for (const [dim, val] of Object.entries(longTermMood)) {
        xml += `    ${dim}: ${val.toFixed(2)}\n`;
      }
      xml += '  </long_term_mood>\n';
    }

    if (state.activeEvents.length > 0) {
      xml += '  <active_events>\n';
      for (const e of state.activeEvents) {
        const agoMin = Math.round((this.now() - e.createdAt) / 60_000);
        const relLabel = e.relevance >= 0.8 ? '高度相关' : e.relevance >= 0.5 ? '相关' : '间接相关';
        // V4: label inspiration events
        const label = e.name.startsWith('inspiration:') ? `灵感: ${e.name.slice(12)}` : e.name;
        xml += `    ${label} (强度${e.intensity.toFixed(1)}, ${relLabel}, ${agoMin}分钟前)\n`;
      }
      xml += '  </active_events>\n';
    }

    xml += '  <trigger_context>\n';
    xml += `    冲动强度: ${(state.value * 100).toFixed(0)}%\n`;
    if (state.memoryPressure > 0.1) {
      xml += `    情绪积压: ${(state.memoryPressure * 100).toFixed(0)}%\n`;
    }
    if (state.suppressionCount > 0) {
      xml += `    已抑制: ${state.suppressionCount}次\n`;
    }
    if (idleMin > 0) {
      xml += `    沉默时长: ${idleMin}分钟\n`;
    }
    xml += '  </trigger_context>\n</internal_state>';

    // V5: Inject behavioral envelope when state != 'normal' (skip if disabled for A/B testing)
    const envelope = this.evaluateBehavioralState(agentId, agent);
    if (envelope.state !== 'normal' && !this.envelopeDisabled.has(agentId)) {
      const stateLabels: Record<BehavioralState, string> = {
        clingy: '黏人', normal: '正常', hesitant: '犹豫', withdrawn: '退缩', cold_war: '冷战',
      };
      const patternInstructions: Record<MessagePattern, string> = {
        single: '用一条完整消息表达。',
        burst: '把想法拆成2-3条短消息发出来，像在聊天一样自然断句。每条不超过30字。',
        fragmented: '把想法拆成2-4条碎片化消息，像在边想边说。每条不超过30字。',
        minimal: '用最少的字回复，1-3个字即可。',
      };
      xml += `\n<behavioral_envelope>\n  当前状态: ${stateLabels[envelope.state]}`;
      xml += `\n  表达方式: ${patternInstructions[envelope.messagePattern]}`;
      if (envelope.emotionalTone) xml += `\n  情绪基调: ${envelope.emotionalTone}`;
      if (envelope.suppressFollowUp) xml += `\n  约束: 不要追问，等对方回复。`;
      xml += '\n</behavioral_envelope>';
    }

    // V6: Inject unsent drafts (message_suppressed monologues)
    // Use a default userId from the most recent inbox message if available
    const draftUserId = state.inbox.find(m => !m.processed)?.messageId;
    if (draftUserId || state.activeEvents.length > 0) {
      // Try to find drafts for any user — use agentId-level query
      const drafts = this.stmts.getUnconsumedDrafts.all(agentId, agentId) as any[];
      if (drafts.length > 0) {
        xml += '\n<unsent_thoughts>';
        for (const d of drafts) {
          const agoMin = Math.round((this.now() - new Date(d.created_at).getTime()) / 60_000);
          xml += `\n  [${agoMin}分钟前] ${d.content}`;
          this.stmts.markDraftConsumed.run(d.id);
        }
        xml += '\n</unsent_thoughts>';
      }
    }

    return xml;
  }

  /** Fire impulse: generate proactive message with context-rich prompt */
  private async fireImpulse(agentId: string, agent: AgentIdentity, state: ImpulseState): Promise<void> {
    if (!this.generateFn) return;

    const internalState = this.formatInternalState(agentId, agent, state);
    const promptTemplate = agent.card.proactive?.impulse?.promptTemplate ?? '基于当前内心状态，自然地主动发一条消息。';

    // V5: Compute envelope and modify prompt (skip multi-message when envelope disabled)
    const envelope = this.evaluateBehavioralState(agentId, agent);
    const envelopeActive = !this.envelopeDisabled.has(agentId);
    let prompt = `${promptTemplate}\n\n${internalState}`;
    if (envelopeActive && envelope.messagePattern !== 'single' && envelope.messagePattern !== 'minimal') {
      prompt += `\n\n请以[MSG]...[/MSG]标签格式输出${envelope.maxMessages}条消息。每条消息独立成句。`;
    }
    prompt += `\n\n请以${agent.card.name}的身份，基于以上内心状态，自然地主动发一条消息给用户。不要提及情绪数值或系统状态。`;

    const triggerType = this.determineTriggerType(agentId, agent.card.proactive!.impulse!);
    const events = state.activeEvents.map(e => e.name).join(', ') || '内心积累';
    console.log(`[Impulse] Firing for ${agent.name} (impulse=${state.value.toFixed(3)}, type=${triggerType}, events=[${events}], state=${envelope.state})`);

    try {
      const content = await this.generateFn(agentId, prompt);
      if (!content || content.length < 2) return;

      // V3: dedup check
      if (await this.isDuplicate(agentId, content)) return;

      // V5: Parse into MessagePlan and store each message (skip multi-message when envelope disabled)
      const normalEnvelope: BehavioralEnvelope = { state: 'normal', responseMode: 'normal', messagePattern: 'single', replyProbability: 1, delayRange: [1000, 10000], maxMessages: 1, emotionalTone: '', suppressFollowUp: false };
      const plan = this.parseMessagePlan(content, envelopeActive ? envelope : normalEnvelope);
      const firstId = `impulse-${agentId}-${this.now()}`;

      for (let i = 0; i < plan.messages.length; i++) {
        const msg = plan.messages[i];
        const id = i === 0 ? firstId : `${firstId}-${i}`;
        this.stmts.insertMessage.run(id, agentId, 'impulse', triggerType, msg.text);
        this.notifyMessage(agentId, id, 'impulse', triggerType, msg.text, msg.delayMs);
      }

      // V4: Self-action feedback — track awaiting response
      this.addActiveEvent(agentId, 'awaiting_response', 0.3, 0.3, 0.5);
      state.awaitingResponse = true;
      state.awaitingMessageId = firstId;

      await this.audit.log({
        timestamp: this.nowDate(),
        actor: `agent:${agentId}`,
        action: 'proactive.impulse_fire',
        target: firstId,
        details: {
          impulse: state.value, triggerType,
          events: state.activeEvents.map(e => e.name),
          emotion: this.emotion.getState(agentId),
          envelope: { state: envelope.state, messagePattern: envelope.messagePattern, messageCount: plan.messages.length },
        },
      });
    } catch (err) {
      console.error(`[Impulse] Failed to generate message:`, err);
    }
  }

  /** Fire a trigger: generate message via LLM and queue it */
  private async fireTrigger(agentId: string, index: number, trigger: ProactiveTrigger): Promise<void> {
    if (!this.generateFn) {
      console.warn('[Proactive] No generate function set, skipping trigger');
      return;
    }

    const agent = this.identity.getAgent(agentId);
    console.log(`[Proactive] Firing ${trigger.type} trigger for ${agent?.name}: "${trigger.prompt}"`);

    try {
      const content = await this.generateFn(agentId, trigger.prompt);
      if (!content || content.length < 2) return;

      // V3: dedup check
      if (await this.isDuplicate(agentId, content)) return;

      const id = `proactive-${agentId}-${this.now()}`;
      this.stmts.insertMessage.run(id, agentId, `trigger-${index}`, trigger.type, content);
      this.notifyMessage(agentId, id, `trigger-${index}`, trigger.type, content);

      await this.audit.log({
        timestamp: this.nowDate(),
        actor: `agent:${agentId}`,
        action: 'proactive.fire',
        target: id,
        details: { triggerType: trigger.type, triggerPrompt: trigger.prompt },
      });
    } catch (err) {
      console.error(`[Proactive] Failed to generate message:`, err);
    }
  }

  /** Fire an event trigger by name (called from API) */
  async fireEvent(agentId: string, eventName: string): Promise<ProactiveMessage | null> {
    const agent = this.identity.getAgent(agentId);
    if (!agent?.card.proactive?.enabled) return null;

    // Inject into impulse system as well
    this.addActiveEvent(agentId, eventName, 0.8);

    const triggers = agent.card.proactive.triggers;
    const idx = triggers.findIndex(t => t.type === 'event' && t.condition === eventName);
    if (idx === -1) return null;

    await this.fireTrigger(agentId, idx, triggers[idx]);
    const pending = this.getPendingMessages(agentId, 1);
    return pending[0] ?? null;
  }

  /** Get pending (undelivered) proactive messages */
  getPendingMessages(agentId: string, limit = 10): ProactiveMessage[] {
    const rows = this.stmts.getPending.all(agentId, limit) as any[];
    return rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      triggerId: r.trigger_id,
      triggerType: r.trigger_type as ProactiveTriggerType,
      content: r.content,
      delivered: !!r.delivered,
      deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
      createdAt: new Date(r.created_at),
    }));
  }

  /** Mark a message as delivered */
  markDelivered(messageId: string): void {
    this.stmts.markDelivered.run(messageId);
  }

  /** Notify callback about a newly generated message */
  private notifyMessage(agentId: string, id: string, triggerId: string, triggerType: string, content: string, delayMs = 0): void {
    if (!this.onMessageFn) return;
    try {
      this.onMessageFn(agentId, {
        id, agentId, triggerId, triggerType: triggerType as ProactiveTriggerType,
        content, delivered: false, delayMs, createdAt: this.nowDate(),
      });
    } catch { /* don't let callback errors break the engine */ }
  }

  // === Engine interface ===

  async getPromptFragments(_context: EngineContext): Promise<PromptFragment[]> {
    // Proactive engine doesn't inject prompt fragments during normal chat
    return [];
  }

  async onResponse(_response: string, context: EngineContext): Promise<void> {
    // V6: Conversation tempo tracking (EMA of user reply speed) — must read before recordActivity
    const state = this.impulseStates.get(context.agentId);
    if (state) {
      const lastMsg = this.lastActivity.get(context.agentId) ?? this.now();
      const replyMs = this.now() - lastMsg;
      if (replyMs > 0 && replyMs < 3_600_000) { // only track if < 1 hour
        const alpha = 0.3;
        state.conversationTempo = state.conversationTempo === 0
          ? replyMs
          : alpha * replyMs + (1 - alpha) * state.conversationTempo;
      }
    }

    // Record activity on each conversation turn
    this.recordActivity(context.agentId);

    // V6: Update relationship via LLM (async, don't block)
    const userId = context.message.author.id;
    this.updateRelationshipViaLLM(context.agentId, userId, context.message.content, _response)
      .catch(() => { /* don't let relationship update errors break the engine */ });

    // V6: Inner monologue on message received
    this.generateInnerMonologue(context.agentId, userId, 'message_received',
      `收到消息: "${context.message.content.slice(0, 100)}"`)
      .catch(() => { });

    // V3: detect user reaction to proactive messages
    this.detectReaction(context.agentId);

    // Detect conversation events and inject into impulse system
    const regexEvents = this.detectConversationEvents(context.message.content);

    // V3: if regex found candidates, try LLM confirmation
    if (regexEvents.length > 0 && this.analyzeFn) {
      // Fire LLM verification asynchronously — don't block the response
      this.detectEventsWithLLM(context.agentId, context.message.content, regexEvents, context.conversationHistory)
        .then(confirmedEvents => {
          for (const e of confirmedEvents) {
            this.addActiveEvent(context.agentId, e.name, e.intensity, 0.5, e.relevance);
          }
        })
        .catch(() => {
          // LLM failed — fall back to regex results
          for (const e of regexEvents) {
            this.addActiveEvent(context.agentId, e.name, e.intensity, 0.5, e.relevance);
          }
        });
    } else {
      // No LLM available or no regex hits — use regex results directly
      for (const e of regexEvents) {
        this.addActiveEvent(context.agentId, e.name, e.intensity, 0.5, e.relevance);
      }
    }
  }

  fallback(): PromptFragment[] {
    return [];
  }
}

/** Sigmoid function for probabilistic firing */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Bigram Jaccard similarity — fallback when embedding is unavailable */
function bigramJaccard(a: string, b: string): number {
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a), setB = bigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const bg of setA) if (setB.has(bg)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}
