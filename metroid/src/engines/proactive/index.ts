import type Database from 'better-sqlite3';
import type { MetroidConfig } from '../../config.js';
import type { IdentityEngine } from '../identity/index.js';
import type { EmotionEngine } from '../emotion/index.js';
import type { AuditLog } from '../../security/audit.js';
import type {
  Engine, EngineContext, PromptFragment,
  ProactiveTrigger, ProactiveTriggerType, ProactiveMessage,
  EmotionState, ImpulseState, ImpulseSignal, ActiveEvent,
  AgentIdentity,
} from '../../types.js';

/** Timestamped emotion snapshot for ring buffer */
interface EmotionSnapshot {
  time: number;
  state: EmotionState;
}

const EMOTION_HISTORY_MAX = 60; // keep ~60 snapshots (1 per check interval)

// Conversation event detection keywords (bilingual)
const EVENT_PATTERNS: Array<{ pattern: RegExp; event: string; intensity: number }> = [
  { pattern: /再见|告别|离开|出国|分别|farewell|goodbye|leaving/i, event: 'farewell', intensity: 0.8 },
  { pattern: /吵架|生气|讨厌你|不理你|conflict|angry|hate/i, event: 'conflict', intensity: 0.7 },
  { pattern: /想你|好久不见|miss you|missed you/i, event: 'longing', intensity: 0.6 },
  { pattern: /孤独|寂寞|一个人|lonely|alone/i, event: 'loneliness', intensity: 0.5 },
  { pattern: /生日|纪念日|birthday|anniversary/i, event: 'celebration', intensity: 0.7 },
  { pattern: /难过|伤心|哭|sad|crying|tears/i, event: 'distress', intensity: 0.6 },
  { pattern: /喜欢你|爱你|love you|like you|表白|confession/i, event: 'intimacy', intensity: 0.8 },
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
        UPDATE proactive_messages SET delivered = 1 WHERE id = ?
      `),
      countPending: this.db.prepare(`
        SELECT COUNT(*) as cnt FROM proactive_messages
        WHERE agent_id = ? AND delivered = 0
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
      const timer = this.timers.get(agentId);
      if (timer) { clearInterval(timer); this.timers.delete(agentId); }
      this.emotionHistory.delete(agentId);
      this.impulseStates.delete(agentId);
    } else {
      for (const [id, timer] of this.timers) {
        clearInterval(timer);
      }
      this.timers.clear();
      this.emotionHistory.clear();
      this.impulseStates.clear();
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
      });
    }
  }

  /** Inject an event into the impulse system (from API or conversation detection) */
  addActiveEvent(agentId: string, name: string, intensity: number, decayRate = 0.5): void {
    const state = this.impulseStates.get(agentId);
    if (!state) return;
    // Don't duplicate — refresh intensity if same event exists
    const existing = state.activeEvents.find(e => e.name === name);
    if (existing) {
      existing.intensity = Math.max(existing.intensity, intensity);
      existing.createdAt = this.now();
    } else {
      state.activeEvents.push({ name, intensity, createdAt: this.now(), decayRate });
    }
    console.log(`[Impulse] Event '${name}' (intensity=${intensity}) added for ${agentId}`);
  }

  /** Get current impulse state (for debug endpoint) */
  getImpulseState(agentId: string): ImpulseState | undefined {
    return this.impulseStates.get(agentId);
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

    // 1. Decay active events
    for (let i = state.activeEvents.length - 1; i >= 0; i--) {
      const e = state.activeEvents[i];
      const eventHours = (now - e.createdAt) / 3_600_000;
      e.intensity *= Math.exp(-e.decayRate * eventHours);
      if (e.intensity < 0.05) state.activeEvents.splice(i, 1);
    }

    // 2. Compute event gate (max intensity of active events)
    const eventGate = state.activeEvents.length > 0
      ? Math.max(...state.activeEvents.map(e => e.intensity))
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
    const fireThreshold = impulseConfig.fireThreshold ?? this.config.proactive.impulseFireThreshold;
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
      }
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
      default:
        return 0;
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
  private detectConversationEvents(text: string): Array<{ name: string; intensity: number }> {
    const events: Array<{ name: string; intensity: number }> = [];
    for (const { pattern, event, intensity } of EVENT_PATTERNS) {
      if (pattern.test(text)) {
        events.push({ name: event, intensity });
      }
    }
    return events;
  }

  /** Fire impulse: generate proactive message with context-rich prompt */
  private async fireImpulse(agentId: string, agent: AgentIdentity, state: ImpulseState): Promise<void> {
    if (!this.generateFn) return;

    const emotionState = this.emotion.getState(agentId);
    const events = state.activeEvents.map(e => e.name).join(', ') || '内心积累';
    const emotionDesc = emotionState
      ? `P=${emotionState.pleasure.toFixed(2)} A=${emotionState.arousal.toFixed(2)} D=${emotionState.dominance.toFixed(2)}`
      : 'unknown';

    const promptTemplate = agent.card.proactive?.impulse?.promptTemplate ?? '基于当前内心状态，自然地主动发一条消息。';
    const prompt = `${promptTemplate}\n\n<internal_state>\n当前情绪: ${emotionDesc}\n触发因素: ${events}\n冲动强度: ${(state.value * 100).toFixed(0)}%\n</internal_state>\n\n请以${agent.card.name}的身份，基于以上内心状态，自然地主动发一条消息给用户。不要提及情绪数值或系统状态。`;

    console.log(`[Impulse] Firing for ${agent.name} (impulse=${state.value.toFixed(3)}, events=[${events}])`);

    try {
      const content = await this.generateFn(agentId, prompt);
      if (!content || content.length < 2) return;

      const id = `impulse-${agentId}-${this.now()}`;
      this.stmts.insertMessage.run(id, agentId, 'impulse', 'emotion', content);
      this.notifyMessage(agentId, id, 'impulse', 'emotion', content);

      await this.audit.log({
        timestamp: this.nowDate(),
        actor: `agent:${agentId}`,
        action: 'proactive.impulse_fire',
        target: id,
        details: { impulse: state.value, events: state.activeEvents.map(e => e.name), emotion: emotionState },
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
      createdAt: new Date(r.created_at),
    }));
  }

  /** Mark a message as delivered */
  markDelivered(messageId: string): void {
    this.stmts.markDelivered.run(messageId);
  }

  /** Notify callback about a newly generated message */
  private notifyMessage(agentId: string, id: string, triggerId: string, triggerType: string, content: string): void {
    if (!this.onMessageFn) return;
    try {
      this.onMessageFn(agentId, {
        id, agentId, triggerId, triggerType: triggerType as ProactiveTriggerType,
        content, delivered: false, createdAt: this.nowDate(),
      });
    } catch { /* don't let callback errors break the engine */ }
  }

  // === Engine interface ===

  async getPromptFragments(_context: EngineContext): Promise<PromptFragment[]> {
    // Proactive engine doesn't inject prompt fragments during normal chat
    return [];
  }

  async onResponse(_response: string, context: EngineContext): Promise<void> {
    // Record activity on each conversation turn
    this.recordActivity(context.agentId);
    // Detect conversation events and inject into impulse system
    const events = this.detectConversationEvents(context.message.content);
    for (const e of events) {
      this.addActiveEvent(context.agentId, e.name, e.intensity);
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
