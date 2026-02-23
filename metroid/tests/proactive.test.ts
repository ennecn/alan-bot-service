import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers.js';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { EmotionEngine } from '../src/engines/emotion/index.js';
import { ProactiveEngine } from '../src/engines/proactive/index.js';
import { AuditLog } from '../src/security/audit.js';
import type { MetroidCard, EngineContext, MetroidMessage } from '../src/types.js';
import type Database from 'better-sqlite3';

const testConfig = {
  dataDir: ':memory:', dbPath: ':memory:',
  memory: { encodingSampleRate: 0.3, importanceThreshold: 0.4, fadeThreshold: 0.3, maxRetrievalResults: 5, defaultTimeWindowHours: 72 },
  llm: { apiKey: 'test', mainModel: 'test', lightModel: 'test', maxContextTokens: 200_000 },
  compiler: { responseReserveRatio: 0.3 },
  emotion: { minChangeInterval: 0, maxChangePerUpdate: 0.3, recoveryRate: 0.05 },
  growth: { evaluationInterval: 10, minConfidence: 0.5, maxActiveChanges: 20 },
  proactive: {
    checkIntervalMs: 60_000,
    maxPendingMessages: 5,
    defaultCooldownMinutes: 60,
    impulseDecayRate: 0.1,
    impulseFireThreshold: 0.6,
    impulseCooldownMinutes: 30,
  },
};

function makeMsg(content: string): MetroidMessage {
  return { id: `msg-${Date.now()}`, content, author: { id: 'u1', name: 'User', isBot: false }, timestamp: Date.now(), channel: 'telegram' } as any;
}

function ctx(agentId: string, msg: string): EngineContext {
  return { agentId, mode: 'enhanced', message: makeMsg(msg), conversationHistory: [] };
}

const proactiveCard: MetroidCard = {
  name: 'ProBot', description: 'A proactive bot', personality: 'caring',
  emotion: { baseline: { pleasure: 0, arousal: 0, dominance: 0 }, intensityDial: 0.8 },
  soul: { immutableValues: [], mutableTraits: [] },
  proactive: {
    enabled: true,
    triggers: [
      { type: 'idle', condition: '5', prompt: '用户好久没说话了，主动打个招呼', cooldownMinutes: 10 },
      { type: 'emotion', condition: 'pleasure<-0.3', prompt: '用户似乎不开心，关心一下', cooldownMinutes: 30 },
      { type: 'event', condition: 'birthday', prompt: '祝用户生日快乐！', cooldownMinutes: 1440 },
    ],
  },
};

const impulseCard: MetroidCard = {
  ...proactiveCard,
  name: 'ImpulseBot',
  emotion: {
    baseline: { pleasure: 0, arousal: 0, dominance: 0 },
    intensityDial: 0.8,
    expressiveness: 0.8,
    restraint: 0.2,
  },
  proactive: {
    enabled: true,
    triggers: [],
    impulse: {
      enabled: true,
      signals: [
        { type: 'idle', weight: 0.5, idleMinutes: 30 },
        { type: 'time_of_day', weight: 0.3, timeRange: { start: '08:00', end: '22:00' } },
      ],
      decayRate: 0.1,
      fireThreshold: 0.6,
      cooldownMinutes: 10,
      promptTemplate: '基于当前内心状态，自然地主动发一条消息。',
    },
  },
};

// === Helper functions for new test suites ===

function setImpulseValue(engine: ProactiveEngine, agentId: string, value: number): void {
  const state = engine.getImpulseState(agentId);
  if (state) state.value = value;
}

function makeImpulseCard(overrides?: Partial<MetroidCard['proactive']>['impulse']): MetroidCard {
  return {
    ...proactiveCard,
    name: 'ImpulseTestBot',
    emotion: {
      baseline: { pleasure: 0, arousal: 0, dominance: 0 },
      intensityDial: 0.8,
      expressiveness: 0.8,
      restraint: 0.2,
    },
    proactive: {
      enabled: true,
      triggers: [],
      impulse: {
        enabled: true,
        signals: [
          { type: 'idle', weight: 0.5, idleMinutes: 30 },
        ],
        decayRate: 0.1,
        fireThreshold: 0.6,
        cooldownMinutes: 10,
        promptTemplate: '基于当前内心状态，自然地主动发一条消息。',
        ...overrides,
      },
    },
  };
}

function makeEmotionPatternCard(
  conditions: Array<{ axis: 'pleasure' | 'arousal' | 'dominance'; op: '<' | '>'; value: number }>,
  sustainedMinutes?: number,
): MetroidCard {
  return {
    ...proactiveCard,
    name: 'EmotionPatternBot',
    emotion: {
      baseline: { pleasure: 0, arousal: 0, dominance: 0 },
      intensityDial: 0.8,
      expressiveness: 0.8,
      restraint: 0.2,
    },
    proactive: {
      enabled: true,
      triggers: [],
      impulse: {
        enabled: true,
        signals: [
          {
            type: 'emotion_pattern',
            weight: 1.0,
            emotionCondition: { conditions, sustainedMinutes },
          },
        ],
        decayRate: 0.01,
        fireThreshold: 0.3,
        cooldownMinutes: 1,
        promptTemplate: 'emotion pattern test',
      },
    },
  };
}

describe('ProactiveEngine', () => {
  let db: Database.Database;
  let identity: IdentityEngine;
  let emotion: EmotionEngine;
  let audit: AuditLog;
  let engine: ProactiveEngine;
  let agentId: string;

  beforeEach(() => {
    db = createTestDb();
    audit = new AuditLog(db);
    identity = new IdentityEngine(db);
    emotion = new EmotionEngine(db, identity, audit, testConfig);
    engine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
  });

  afterEach(() => {
    engine.stop();
  });

  // === Trigger Evaluation ===

  describe('idle trigger', () => {
    const responses = ['你好呀，好久不见！', '最近过得怎么样？有什么新鲜事吗？', '在忙什么呢，要不要聊聊天？'];
    let callCount = 0;
    beforeEach(() => {
      callCount = 0;
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
      engine.setGenerateFn(async (_id, _prompt) => responses[callCount++ % responses.length]);
    });

    it('should not fire before idle threshold', async () => {
      engine.start(agentId);
      engine.advanceTime(3); // 3 min < 5 min threshold
      await engine.evaluateAll(agentId);
      const msgs = engine.getPendingMessages(agentId);
      expect(msgs).toHaveLength(0);
    });

    it('should fire after idle threshold', async () => {
      engine.start(agentId);
      engine.advanceTime(6); // 6 min > 5 min threshold
      await engine.evaluateAll(agentId);
      const msgs = engine.getPendingMessages(agentId);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toContain('你好呀，好久不见！');
      expect(msgs[0].triggerType).toBe('idle');
    });

    it('should respect cooldown', async () => {
      engine.start(agentId);
      engine.advanceTime(6);
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId)).toHaveLength(1);

      // Advance 5 more min (still within 10 min cooldown)
      engine.advanceTime(5);
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId)).toHaveLength(1); // still just 1

      // Advance past cooldown
      engine.advanceTime(6); // total 17 min since fire
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId)).toHaveLength(2);
    });

    it('should reset idle on activity', async () => {
      engine.start(agentId);
      engine.advanceTime(4);
      engine.recordActivity(agentId); // reset idle timer
      engine.advanceTime(3); // 3 min since last activity
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId)).toHaveLength(0);
    });
  });

  describe('emotion trigger (legacy)', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
      engine.setGenerateFn(async () => '你还好吗？');
    });

    it('should fire when emotion condition met', async () => {
      engine.start(agentId);
      // Set emotion state to low pleasure
      const agent = identity.getAgent(agentId)!;
      agent.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      await engine.evaluateAll(agentId);
      const msgs = engine.getPendingMessages(agentId);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].triggerType).toBe('emotion');
    });

    it('should not fire when emotion condition not met', async () => {
      engine.start(agentId);
      const agent = identity.getAgent(agentId)!;
      agent.emotionState = { pleasure: 0.2, arousal: 0, dominance: 0 };
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId)).toHaveLength(0);
    });
  });

  describe('event trigger', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
      engine.setGenerateFn(async () => '生日快乐！🎂');
    });

    it('should fire event by name', async () => {
      engine.start(agentId);
      const msg = await engine.fireEvent(agentId, 'birthday');
      expect(msg).not.toBeNull();
      expect(msg!.content).toBe('生日快乐！🎂');
      expect(msg!.triggerType).toBe('event');
    });

    it('should return null for unknown event', async () => {
      engine.start(agentId);
      const msg = await engine.fireEvent(agentId, 'nonexistent');
      expect(msg).toBeNull();
    });

    it('should inject event into impulse system', async () => {
      engine.start(agentId);
      await engine.fireEvent(agentId, 'birthday');
      const state = engine.getImpulseState(agentId);
      const birthdayEvent = state?.activeEvents.find(e => e.name === 'birthday');
      expect(birthdayEvent).toBeDefined();
      expect(birthdayEvent!.intensity).toBe(0.8);
    });
  });

  // === Message Management ===

  describe('message management', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
      engine.setGenerateFn(async () => 'hello');
    });

    it('should mark messages as delivered', async () => {
      engine.start(agentId);
      engine.advanceTime(6);
      await engine.evaluateAll(agentId);
      const msgs = engine.getPendingMessages(agentId);
      expect(msgs).toHaveLength(1);

      engine.markDelivered(msgs[0].id);
      expect(engine.getPendingMessages(agentId)).toHaveLength(0);
    });

    it('should respect maxPendingMessages', async () => {
      engine.start(agentId);
      // Insert 5 pending messages directly
      for (let i = 0; i < 5; i++) {
        db.prepare('INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content) VALUES (?, ?, ?, ?, ?)')
          .run(`test-${i}`, agentId, 'test', 'idle', `msg ${i}`);
      }
      engine.advanceTime(6);
      await engine.evaluateAll(agentId);
      // Should not add more since we're at max
      expect(engine.getPendingMessages(agentId)).toHaveLength(5);
    });
  });

  // === Conversation Event Detection ===

  describe('conversation event detection', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
      engine.start(agentId);
    });

    it('should detect farewell events', async () => {
      await engine.onResponse('ok', ctx(agentId, '我要离开了，再见'));
      const state = engine.getImpulseState(agentId);
      const farewell = state?.activeEvents.find(e => e.name === 'farewell');
      expect(farewell).toBeDefined();
      expect(farewell!.intensity).toBe(0.8);
    });

    it('should detect loneliness events', async () => {
      await engine.onResponse('ok', ctx(agentId, '好孤独啊'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents.find(e => e.name === 'loneliness')).toBeDefined();
    });

    it('should detect intimacy events', async () => {
      await engine.onResponse('ok', ctx(agentId, '我喜欢你'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents.find(e => e.name === 'intimacy')).toBeDefined();
    });

    it('should detect distress events', async () => {
      await engine.onResponse('ok', ctx(agentId, '好难过，想哭'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents.find(e => e.name === 'distress')).toBeDefined();
    });

    it('should detect celebration events', async () => {
      await engine.onResponse('ok', ctx(agentId, '今天是我的生日！'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents.find(e => e.name === 'celebration')).toBeDefined();
    });

    it('should detect conflict events', async () => {
      await engine.onResponse('ok', ctx(agentId, '我生气了，讨厌你'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents.find(e => e.name === 'conflict')).toBeDefined();
    });

    it('should detect longing events', async () => {
      await engine.onResponse('ok', ctx(agentId, '好想你啊'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents.find(e => e.name === 'longing')).toBeDefined();
    });

    it('should not inject events for neutral messages', async () => {
      await engine.onResponse('ok', ctx(agentId, '今天天气不错'));
      const state = engine.getImpulseState(agentId);
      expect(state?.activeEvents).toHaveLength(0);
    });
  });

  // === Impulse Accumulator ===

  describe('impulse accumulator', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ImpulseBot', impulseCard, 'enhanced');
      agentId = agent.id;
    });

    it('should initialize impulse state on start', () => {
      engine.start(agentId);
      const state = engine.getImpulseState(agentId);
      expect(state).toBeDefined();
      expect(state!.value).toBe(0);
      expect(state!.activeEvents).toHaveLength(0);
      expect(state!.suppressionCount).toBe(0);
    });

    it('should accumulate idle signal over time', async () => {
      engine.start(agentId);
      engine.advanceTime(15); // 15 min idle (half of 30 min target)
      await engine.evaluateAll(agentId);
      const state = engine.getImpulseState(agentId);
      expect(state!.value).toBeGreaterThan(0);
    });

    it('should add and decay active events', async () => {
      engine.start(agentId);
      engine.addActiveEvent(agentId, 'test-event', 0.8, 1.0);
      const state = engine.getImpulseState(agentId);
      expect(state!.activeEvents).toHaveLength(1);
      expect(state!.activeEvents[0].intensity).toBe(0.8);

      // Advance time to let event decay
      engine.advanceTime(120); // 2 hours
      await engine.evaluateAll(agentId);
      const after = engine.getImpulseState(agentId);
      // Event should have decayed significantly or been removed
      if (after!.activeEvents.length > 0) {
        expect(after!.activeEvents[0].intensity).toBeLessThan(0.8);
      }
    });

    it('should deduplicate events by name (with cooldown penalty)', () => {
      engine.start(agentId);
      engine.addActiveEvent(agentId, 'loneliness', 0.5);
      engine.addActiveEvent(agentId, 'loneliness', 0.8);
      const state = engine.getImpulseState(agentId);
      expect(state!.activeEvents).toHaveLength(1);
      // Within 10 min cooldown: new intensity = 0.8 * 0.5 = 0.4, max(0.5, 0.4) = 0.5
      expect(state!.activeEvents[0].intensity).toBe(0.5);
    });

    it('should not start for classic mode agents', () => {
      const classicAgent = identity.createAgent('Classic', { ...impulseCard }, 'classic');
      engine.start(classicAgent.id);
      expect(engine.getImpulseState(classicAgent.id)).toBeUndefined();
    });

    it('should not start for agents without proactive enabled', () => {
      const noProactive: MetroidCard = { ...impulseCard, proactive: undefined };
      const agent = identity.createAgent('NoProactive', noProactive, 'enhanced');
      engine.start(agent.id);
      expect(engine.getImpulseState(agent.id)).toBeUndefined();
    });
  });

  // === Time Control ===

  describe('time control', () => {
    it('should advance and reset debug clock', () => {
      expect(engine.getTimeOffset()).toBe(0);
      engine.advanceTime(30);
      expect(engine.getTimeOffset()).toBe(30);
      engine.advanceTime(15);
      expect(engine.getTimeOffset()).toBe(45);
      engine.resetClock();
      expect(engine.getTimeOffset()).toBe(0);
    });
  });

  // === Engine Interface ===

  describe('engine interface', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
    });

    it('should return empty prompt fragments', async () => {
      const fragments = await engine.getPromptFragments(ctx(agentId, 'hello'));
      expect(fragments).toHaveLength(0);
    });

    it('should record activity on onResponse', async () => {
      engine.start(agentId);
      engine.advanceTime(10); // 10 min idle
      await engine.onResponse('ok', ctx(agentId, 'hello'));
      // Activity was just recorded, so idle should be near 0
      engine.advanceTime(1); // only 1 min since activity
      await engine.evaluateAll(agentId);
      // Idle trigger needs 5 min, so should not fire
      expect(engine.getPendingMessages(agentId)).toHaveLength(0);
    });

    it('should return empty fallback', () => {
      expect(engine.fallback()).toHaveLength(0);
    });
  });

  // === Cron Trigger ===

  describe('cron trigger', () => {
    it('should fire when time matches cron condition', async () => {
      // Create a card with cron trigger matching current time
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const cronCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'cron', condition: `${hh}:${mm}`, prompt: '早安！', cooldownMinutes: 1440 },
          ],
        },
      };
      const agent = identity.createAgent('CronBot', cronCard, 'enhanced');
      engine.setGenerateFn(async () => '早上好！');
      engine.start(agent.id);
      await engine.evaluateAll(agent.id);
      const msgs = engine.getPendingMessages(agent.id);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].triggerType).toBe('cron');
    });

    it('should not fire when time does not match', async () => {
      const cronCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'cron', condition: '03:33', prompt: '深夜问候', cooldownMinutes: 1440 },
          ],
        },
      };
      const agent = identity.createAgent('CronBot2', cronCard, 'enhanced');
      engine.setGenerateFn(async () => 'hello');
      engine.start(agent.id);
      // Unless it happens to be 03:33, this should not fire
      const now = new Date();
      if (now.getHours() !== 3 || now.getMinutes() !== 33) {
        await engine.evaluateAll(agent.id);
        expect(engine.getPendingMessages(agent.id)).toHaveLength(0);
      }
    });
  });

  // === No generateFn ===

  describe('without generateFn', () => {
    it('should not crash when no generateFn is set', async () => {
      const agent = identity.createAgent('NoGen', proactiveCard, 'enhanced');
      engine.start(agent.id);
      engine.advanceTime(6);
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id)).toHaveLength(0);
    });
  });

  // === onMessage callback ===

  describe('onMessage callback', () => {
    it('should notify callback when message is generated', async () => {
      const agent = identity.createAgent('CallbackBot', proactiveCard, 'enhanced');
      engine.setGenerateFn(async () => 'callback test');
      const received: any[] = [];
      engine.setOnMessageFn((_id, msg) => received.push(msg));
      engine.start(agent.id);
      engine.advanceTime(6);
      await engine.evaluateAll(agent.id);
      expect(received).toHaveLength(1);
      expect(received[0].content).toBe('callback test');
    });
  });

  // === Suite 1: Impulse Firing Decision ===

  describe('impulse firing decision', () => {
    beforeEach(() => {
      const agent = identity.createAgent('ImpulseBot', impulseCard, 'enhanced');
      agentId = agent.id;
      engine.setGenerateFn(async () => 'impulse message');
    });

    it('should accumulate idle signal over time', async () => {
      engine.start(agentId);
      engine.advanceTime(15); // half of 30 min idle target
      await engine.evaluateAll(agentId);
      const state = engine.getImpulseState(agentId)!;
      expect(state.value).toBeGreaterThan(0);
    });

    it('should fire when impulse exceeds threshold and random passes', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // always pass
      engine.start(agentId);
      setImpulseValue(engine, agentId, 0.8); // above 0.6 threshold
      await engine.evaluateAll(agentId);
      const msgs = engine.getPendingMessages(agentId);
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      const impulseMsg = msgs.find(m => m.triggerId === 'impulse');
      expect(impulseMsg).toBeDefined();
      vi.restoreAllMocks();
    });

    it('should suppress when random does not pass', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.999); // never pass
      engine.start(agentId);
      setImpulseValue(engine, agentId, 0.8);
      await engine.evaluateAll(agentId);
      const state = engine.getImpulseState(agentId)!;
      expect(state.suppressionCount).toBeGreaterThanOrEqual(1);
      vi.restoreAllMocks();
    });

    it('should apply suppression bonus to lower dynamic threshold', async () => {
      engine.start(agentId);
      const state = engine.getImpulseState(agentId)!;
      // Simulate 4 suppressions → bonus = 0.2
      state.suppressionCount = 4;
      state.value = 0.65; // just above base threshold
      vi.spyOn(Math, 'random').mockReturnValue(0); // always pass
      await engine.evaluateAll(agentId);
      // With suppression bonus, dynamic threshold is lower → should fire
      const msgs = engine.getPendingMessages(agentId);
      expect(msgs.find(m => m.triggerId === 'impulse')).toBeDefined();
      vi.restoreAllMocks();
    });

    it('should not fire during cooldown period', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      engine.start(agentId);
      setImpulseValue(engine, agentId, 0.8);
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId).find(m => m.triggerId === 'impulse')).toBeDefined();

      // Fire again within cooldown (10 min)
      setImpulseValue(engine, agentId, 0.9);
      engine.advanceTime(5); // only 5 min
      await engine.evaluateAll(agentId);
      // Should still only have 1 impulse message
      const impulseMessages = engine.getPendingMessages(agentId).filter(m => m.triggerId === 'impulse');
      expect(impulseMessages).toHaveLength(1);
      vi.restoreAllMocks();
    });

    it('should not fire when pending messages at max', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      engine.start(agentId);
      // Fill up pending messages
      for (let i = 0; i < 5; i++) {
        db.prepare('INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content) VALUES (?, ?, ?, ?, ?)')
          .run(`fill-${i}`, agentId, 'test', 'idle', `msg ${i}`);
      }
      setImpulseValue(engine, agentId, 0.9);
      await engine.evaluateAll(agentId);
      expect(engine.getPendingMessages(agentId)).toHaveLength(5); // no new ones
      vi.restoreAllMocks();
    });

    it('should set residual impulse to 0.2 after firing', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      engine.start(agentId);
      setImpulseValue(engine, agentId, 0.9);
      await engine.evaluateAll(agentId);
      const state = engine.getImpulseState(agentId)!;
      expect(state.value).toBeCloseTo(0.2, 1);
      vi.restoreAllMocks();
    });

    it('should clamp impulse value to [0, 1]', async () => {
      engine.start(agentId);
      const state = engine.getImpulseState(agentId)!;
      state.value = 1.5;
      await engine.evaluateAll(agentId);
      expect(engine.getImpulseState(agentId)!.value).toBeLessThanOrEqual(1);

      state.value = -0.5;
      await engine.evaluateAll(agentId);
      expect(engine.getImpulseState(agentId)!.value).toBeGreaterThanOrEqual(0);
    });
  });

  // === Suite 2: Signal Activation — emotion_pattern ===

  describe('signal activation — emotion_pattern', () => {
    it('should return activation=1 when all conditions met', async () => {
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: -0.2 },
        { axis: 'arousal', op: '>', value: 0.3 },
      ]);
      const agent = identity.createAgent('EP1', card, 'enhanced');
      engine.start(agent.id);
      // Set emotion state to satisfy conditions
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0.5, dominance: 0 };
      engine.setGenerateFn(async () => 'emotion pattern fired');
      // Add an active event so eventGate > 0
      engine.addActiveEvent(agent.id, 'test-event', 0.8);
      setImpulseValue(engine, agent.id, 0.1);
      engine.advanceTime(60); // give time for gain accumulation
      await engine.evaluateAll(agent.id);
      const state = engine.getImpulseState(agent.id)!;
      // With activation=1, weight=1.0, eventGate=0.8, impulse should increase
      expect(state.value).toBeGreaterThan(0.1);
    });

    it('should return activation=0 when any condition not met', async () => {
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: -0.2 },
        { axis: 'arousal', op: '>', value: 0.3 },
      ]);
      const agent = identity.createAgent('EP2', card, 'enhanced');
      engine.start(agent.id);
      // pleasure satisfied, arousal NOT satisfied
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0.1, dominance: 0 };
      engine.addActiveEvent(agent.id, 'test-event', 0.8);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      const state = engine.getImpulseState(agent.id)!;
      // activation=0 → no gain from emotion_pattern signal
      expect(state.value).toBe(0);
    });

    it('should return activation=0 when emotion state undefined', async () => {
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: -0.2 },
      ]);
      const agent = identity.createAgent('EP3', card, 'enhanced');
      engine.start(agent.id);
      // Don't set emotion state — emotion.getState() returns undefined
      engine.addActiveEvent(agent.id, 'test-event', 0.8);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });

    it('should be gated by active events (eventGate=0 → no effect)', async () => {
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: -0.2 },
      ]);
      const agent = identity.createAgent('EP4', card, 'enhanced');
      engine.start(agent.id);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      // NO active events → eventGate=0
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });

    it('should work when active events present (eventGate>0)', async () => {
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: -0.2 },
      ]);
      const agent = identity.createAgent('EP5', card, 'enhanced');
      engine.start(agent.id);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      engine.addActiveEvent(agent.id, 'loneliness', 0.6);
      setImpulseValue(engine, agent.id, 0.1);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBeGreaterThan(0.1);
    });

    it('should require sustained snapshots when sustainedMinutes set', async () => {
      const card = makeEmotionPatternCard(
        [{ axis: 'pleasure', op: '<', value: -0.2 }],
        10, // sustained for 10 minutes
      );
      const agent = identity.createAgent('EP6', card, 'enhanced');
      engine.start(agent.id);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      engine.addActiveEvent(agent.id, 'test', 0.8);
      // Only 1 snapshot (from start) — need ≥2 in window
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      // With only initial snapshot, sustained check should fail (need ≥2)
      // The value may still be 0 since sustained requires 2+ snapshots
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });
  });

  // === Suite 3: Signal Activation — idle smoothstep ===

  describe('signal activation — idle smoothstep', () => {
    it('should have activation≈0 at 0 minutes idle', async () => {
      const card = makeImpulseCard({
        signals: [{ type: 'idle', weight: 1.0, idleMinutes: 60 }],
      });
      const agent = identity.createAgent('Idle1', card, 'enhanced');
      engine.start(agent.id);
      engine.recordActivity(agent.id); // just active
      setImpulseValue(engine, agent.id, 0);
      // Don't advance time — idle = 0
      await engine.evaluateAll(agent.id);
      // smoothstep(0) = 0, so no gain
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });

    it('should have activation≈smoothstep(0.5) at half idle time', async () => {
      const card = makeImpulseCard({
        signals: [{ type: 'idle', weight: 1.0, idleMinutes: 60 }],
      });
      const agent = identity.createAgent('Idle2', card, 'enhanced');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(30); // half of 60 min
      await engine.evaluateAll(agent.id);
      // smoothstep(0.5) = 0.5, gain = 1.0 * 0.5 * dtHours
      const state = engine.getImpulseState(agent.id)!;
      expect(state.value).toBeGreaterThan(0);
    });

    it('should have activation=1 at or beyond target idle time', async () => {
      const card = makeImpulseCard({
        signals: [{ type: 'idle', weight: 1.0, idleMinutes: 60 }],
      });
      const agent = identity.createAgent('Idle3', card, 'enhanced');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(120); // 2x target
      await engine.evaluateAll(agent.id);
      // smoothstep(1) = 1, max gain
      const state = engine.getImpulseState(agent.id)!;
      expect(state.value).toBeGreaterThan(0);
    });

    it('should reset to 0 after recordActivity', async () => {
      const card = makeImpulseCard({
        signals: [{ type: 'idle', weight: 1.0, idleMinutes: 60 }],
      });
      const agent = identity.createAgent('Idle4', card, 'enhanced');
      engine.start(agent.id);
      engine.advanceTime(30);
      engine.recordActivity(agent.id); // reset idle
      setImpulseValue(engine, agent.id, 0);
      // Don't advance further — idle is now 0
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });
  });

  // === Suite 4: Signal Activation — time_of_day ===

  describe('signal activation — time_of_day', () => {
    it('should return 1 when current time is within range', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T10:00:00') });
      const card = makeImpulseCard({
        signals: [{ type: 'time_of_day', weight: 1.0, timeRange: { start: '08:00', end: '22:00' } }],
      });
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      const agent = identity.createAgent('TOD1', card, 'enhanced');
      localEngine.start(agent.id);
      setImpulseValue(localEngine, agent.id, 0);
      localEngine.advanceTime(60);
      await localEngine.evaluateAll(agent.id);
      expect(localEngine.getImpulseState(agent.id)!.value).toBeGreaterThan(0);
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should return 0 when current time is outside range', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T03:00:00') });
      const card = makeImpulseCard({
        signals: [{ type: 'time_of_day', weight: 1.0, timeRange: { start: '08:00', end: '22:00' } }],
      });
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      const agent = identity.createAgent('TOD2', card, 'enhanced');
      localEngine.start(agent.id);
      setImpulseValue(localEngine, agent.id, 0);
      localEngine.advanceTime(60);
      await localEngine.evaluateAll(agent.id);
      expect(localEngine.getImpulseState(agent.id)!.value).toBe(0);
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should handle midnight-crossing range (start > end)', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T23:30:00') });
      const card = makeImpulseCard({
        signals: [{ type: 'time_of_day', weight: 1.0, timeRange: { start: '22:00', end: '06:00' } }],
      });
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      const agent = identity.createAgent('TOD3', card, 'enhanced');
      localEngine.start(agent.id);
      setImpulseValue(localEngine, agent.id, 0);
      localEngine.advanceTime(60);
      await localEngine.evaluateAll(agent.id);
      expect(localEngine.getImpulseState(agent.id)!.value).toBeGreaterThan(0);
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should return 0 when no timeRange provided', async () => {
      const card = makeImpulseCard({
        signals: [{ type: 'time_of_day', weight: 1.0 }], // no timeRange
      });
      const agent = identity.createAgent('TOD4', card, 'enhanced');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });
  });

  // === Suite 5: Emotion Delta Trigger ===

  describe('emotion delta trigger', () => {
    it('should fire when pleasure drops beyond threshold in window', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const deltaCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'delta:pleasure<-0.3/30m', prompt: 'comfort', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      localEngine.setGenerateFn(async () => 'delta fired');
      const agent = identity.createAgent('Delta1', deltaCard, 'enhanced');
      // Set initial high pleasure
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0, dominance: 0 };
      localEngine.start(agent.id); // records snapshot #1 with pleasure=0.5
      // Trigger interval to record snapshot #2
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs);
      await new Promise(r => process.nextTick(r));
      // Now drop pleasure significantly
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.1, arousal: 0, dominance: 0 };
      // Trigger interval to record snapshot #3 with low pleasure + evaluate
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs);
      await new Promise(r => process.nextTick(r));
      const msgs = localEngine.getPendingMessages(agent.id);
      expect(msgs.find(m => m.triggerType === 'emotion')).toBeDefined();
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should not fire when drop is below threshold', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const deltaCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'delta:pleasure<-0.3/30m', prompt: 'comfort', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      localEngine.setGenerateFn(async () => 'should not fire');
      const agent = identity.createAgent('Delta2', deltaCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0, dominance: 0 };
      localEngine.start(agent.id);
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs);
      await new Promise(r => process.nextTick(r));
      // Small drop — only 0.1
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.4, arousal: 0, dominance: 0 };
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs);
      await new Promise(r => process.nextTick(r));
      expect(localEngine.getPendingMessages(agent.id)).toHaveLength(0);
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should not fire with fewer than 2 snapshots', async () => {
      const deltaCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'delta:pleasure<-0.5/30m', prompt: 'comfort', cooldownMinutes: 60 },
          ],
        },
      };
      const agent = identity.createAgent('Delta3', deltaCard, 'enhanced');
      engine.setGenerateFn(async () => 'should not fire');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.8, arousal: 0, dominance: 0 };
      engine.start(agent.id);
      // Only 1 snapshot from start — evaluateAll won't add another
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id)).toHaveLength(0);
    });

    it('should handle > operator correctly', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const deltaCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'delta:arousal>0.4/30m', prompt: 'excited', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      localEngine.setGenerateFn(async () => 'arousal spike');
      const agent = identity.createAgent('Delta4', deltaCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0, arousal: -0.2, dominance: 0 };
      localEngine.start(agent.id);
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs);
      await new Promise(r => process.nextTick(r));
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0, arousal: 0.5, dominance: 0 };
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs);
      await new Promise(r => process.nextTick(r));
      expect(localEngine.getPendingMessages(agent.id).find(m => m.triggerType === 'emotion')).toBeDefined();
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should not crash on unparseable expression', async () => {
      const deltaCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'delta:garbage!!!', prompt: 'nope', cooldownMinutes: 60 },
          ],
        },
      };
      const agent = identity.createAgent('Delta5', deltaCard, 'enhanced');
      engine.setGenerateFn(async () => 'should not fire');
      engine.start(agent.id);
      engine.advanceTime(10);
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id)).toHaveLength(0);
    });
  });

  // === Suite 6: Emotion Sustained Trigger ===

  describe('emotion sustained trigger', () => {
    it('should fire when all snapshots in window satisfy condition', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const sustainedCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.2/5m', prompt: 'sustained low', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      localEngine.setGenerateFn(async () => 'sustained fired');
      const agent = identity.createAgent('Sust1', sustainedCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      localEngine.start(agent.id); // snapshot #1
      // Trigger intervals to record more snapshots
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs); // snapshot #2
      await new Promise(r => process.nextTick(r));
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs); // snapshot #3 + evaluate
      await new Promise(r => process.nextTick(r));
      const msgs = localEngine.getPendingMessages(agent.id);
      expect(msgs.find(m => m.triggerType === 'emotion')).toBeDefined();
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should not fire when any snapshot violates condition', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const sustainedCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.2/5m', prompt: 'sustained low', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, testConfig);
      localEngine.setGenerateFn(async () => 'should not fire');
      const agent = identity.createAgent('Sust2', sustainedCard, 'enhanced');
      // Start with low pleasure
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      localEngine.start(agent.id); // snapshot #1 (low)
      // Briefly recover BEFORE next interval
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.1, arousal: 0, dominance: 0 };
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs); // snapshot #2 (high — violates)
      await new Promise(r => process.nextTick(r));
      // Drop again
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      vi.advanceTimersByTime(testConfig.proactive.checkIntervalMs); // snapshot #3 (low)
      await new Promise(r => process.nextTick(r));
      // Snapshot #2 violates the condition → should not fire
      expect(localEngine.getPendingMessages(agent.id)).toHaveLength(0);
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should not fire with fewer than 2 snapshots in window', async () => {
      const sustainedCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.2/1m', prompt: 'too short', cooldownMinutes: 60 },
          ],
        },
      };
      const agent = identity.createAgent('Sust3', sustainedCard, 'enhanced');
      engine.setGenerateFn(async () => 'should not fire');
      engine.start(agent.id);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      // Only initial snapshot, no interval triggered
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id)).toHaveLength(0);
    });

    it('should only consider snapshots within the time window', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      // Use short check interval (10s) so we can accumulate snapshots quickly
      const cfg = { ...testConfig, proactive: { ...testConfig.proactive, checkIntervalMs: 10_000 } };
      const sustainedCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.2/1m', prompt: 'windowed', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, cfg);
      localEngine.setGenerateFn(async () => 'windowed fired');
      const agent = identity.createAgent('Sust4', sustainedCard, 'enhanced');
      // Old snapshot with high pleasure
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0, dominance: 0 };
      localEngine.start(agent.id); // snapshot at t=0 (high)
      // Now set low pleasure
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      // Advance enough intervals so old snapshot falls outside 1m window
      for (let i = 0; i < 12; i++) { // 12 × 10s = 120s > 60s window
        vi.advanceTimersByTime(10_000);
      }
      await new Promise(r => process.nextTick(r));
      // Recent snapshots all satisfy, old one is outside 1m window
      const msgs = localEngine.getPendingMessages(agent.id);
      expect(msgs.find(m => m.triggerType === 'emotion')).toBeDefined();
      localEngine.stop();
      vi.useRealTimers();
    });
  });

  // === Suite 7: Emotion History Ring Buffer ===

  describe('emotion history ring buffer', () => {
    it('should not crash after many interval ticks (ring buffer eviction)', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const cfg = { ...testConfig, proactive: { ...testConfig.proactive, checkIntervalMs: 100 } };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, cfg);
      const agent = identity.createAgent('Ring1', proactiveCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0, arousal: 0, dominance: 0 };
      localEngine.start(agent.id);

      // Trigger 70 intervals (exceeds EMOTION_HISTORY_MAX=60)
      for (let i = 0; i < 70; i++) {
        vi.advanceTimersByTime(100);
      }
      // Flush any pending microtasks
      await new Promise(r => process.nextTick(r));

      // Engine should still function correctly after ring buffer eviction
      await localEngine.evaluateAll(agent.id);
      expect(true).toBe(true); // no crash = pass
      localEngine.stop();
      vi.useRealTimers();
    });

    it('should maintain time ordering in ring buffer', async () => {
      vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
      const cfg = { ...testConfig, proactive: { ...testConfig.proactive, checkIntervalMs: 1000 } };
      // Use sustained trigger to verify snapshots are in order
      const sustainedCard: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.1/5m', prompt: 'ordered', cooldownMinutes: 60 },
          ],
        },
      };
      const localEngine = new ProactiveEngine(db, identity, emotion, audit, cfg);
      localEngine.setGenerateFn(async () => 'ordered test');
      const agent = identity.createAgent('Ring2', sustainedCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      localEngine.start(agent.id);
      // Record several snapshots
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(1000);
      }
      await new Promise(r => process.nextTick(r));
      // Sustained trigger should work (all snapshots satisfy, in order)
      const msgs = localEngine.getPendingMessages(agent.id);
      expect(msgs.find(m => m.triggerType === 'emotion')).toBeDefined();
      localEngine.stop();
      vi.useRealTimers();
    });
  });

  // === Suite 8: Impulse Message Generation (fireImpulse) ===

  describe('impulse message generation', () => {
    it('should include structured internal state and events in prompt', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire1', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.3, arousal: 0.5, dominance: 0.1 };
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test msg'; });
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'loneliness', 0.6);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('<internal_state>');
      expect(capturedPrompt).toContain('<emotion_trajectory>');
      expect(capturedPrompt).toContain('<trigger_context>');
      expect(capturedPrompt).toContain('loneliness');
      expect(capturedPrompt).toContain('冲动强度');
      vi.restoreAllMocks();
    });

    it('should record triggerType based on dominant signal in DB', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire2', card, 'enhanced');
      engine.setGenerateFn(async () => 'db test');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msgs = engine.getPendingMessages(agent.id);
      const impulseMsg = msgs.find(m => m.triggerId === 'impulse');
      expect(impulseMsg).toBeDefined();
      // idle-only card → impulse:idle
      expect(impulseMsg!.triggerType).toBe('impulse:idle');
      vi.restoreAllMocks();
    });

    it('should write audit log on fire', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire3', card, 'enhanced');
      engine.setGenerateFn(async () => 'audit test');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      // Check audit log in DB
      const logs = db.prepare('SELECT * FROM audit_log WHERE action = ?').all('proactive.impulse_fire');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      vi.restoreAllMocks();
    });

    it('should not insert message when generateFn returns empty string', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire4', card, 'enhanced');
      engine.setGenerateFn(async () => '');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id).filter(m => m.triggerId === 'impulse')).toHaveLength(0);
      vi.restoreAllMocks();
    });

    it('should not insert message when generateFn returns single char', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire5', card, 'enhanced');
      engine.setGenerateFn(async () => 'x');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id).filter(m => m.triggerId === 'impulse')).toHaveLength(0);
      vi.restoreAllMocks();
    });

    it('should call onMessageFn callback on successful fire', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire6', card, 'enhanced');
      engine.setGenerateFn(async () => 'callback impulse');
      const received: any[] = [];
      engine.setOnMessageFn((_id, msg) => received.push(msg));
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(received.find(m => m.triggerId === 'impulse')).toBeDefined();
      vi.restoreAllMocks();
    });

    it('should use default template when no promptTemplate provided', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard({ promptTemplate: undefined as any });
      const agent = identity.createAgent('Fire7', card, 'enhanced');
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'default template'; });
      engine.start(agent.id);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('基于当前内心状态');
      vi.restoreAllMocks();
    });

    it('should omit active_events section when no active events', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Fire8', card, 'enhanced');
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'no events'; });
      engine.start(agent.id);
      // No active events added
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).not.toContain('<active_events>');
      expect(capturedPrompt).toContain('<trigger_context>');
      vi.restoreAllMocks();
    });
  });

  // === Suite 9: Multi-Agent Isolation ===

  describe('multi-agent isolation', () => {
    let agentA: string;
    let agentB: string;

    beforeEach(() => {
      const a = identity.createAgent('AgentA', impulseCard, 'enhanced');
      const b = identity.createAgent('AgentB', impulseCard, 'enhanced');
      agentA = a.id;
      agentB = b.id;
      engine.setGenerateFn(async () => 'isolated msg');
      engine.start(agentA);
      engine.start(agentB);
    });

    it('should have independent impulse values', () => {
      setImpulseValue(engine, agentA, 0.8);
      expect(engine.getImpulseState(agentA)!.value).toBe(0.8);
      expect(engine.getImpulseState(agentB)!.value).toBe(0);
    });

    it('should have independent active events', () => {
      engine.addActiveEvent(agentA, 'loneliness', 0.5);
      expect(engine.getImpulseState(agentA)!.activeEvents).toHaveLength(1);
      expect(engine.getImpulseState(agentB)!.activeEvents).toHaveLength(0);
    });

    it('should have independent cooldowns', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agentA, 0.9);
      await engine.evaluateAll(agentA);
      // Agent A fired, now in cooldown
      expect(engine.getImpulseState(agentA)!.lastFireTime).toBeGreaterThan(0);
      // Agent B should not be affected
      expect(engine.getImpulseState(agentB)!.lastFireTime).toBe(0);
      vi.restoreAllMocks();
    });

    it('should have independent suppression counts', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.999);
      setImpulseValue(engine, agentA, 0.9);
      await engine.evaluateAll(agentA);
      expect(engine.getImpulseState(agentA)!.suppressionCount).toBeGreaterThanOrEqual(1);
      expect(engine.getImpulseState(agentB)!.suppressionCount).toBe(0);
      vi.restoreAllMocks();
    });

    it('should not let agent A firing affect agent B', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agentA, 0.9);
      await engine.evaluateAll(agentA);
      const msgsA = engine.getPendingMessages(agentA);
      const msgsB = engine.getPendingMessages(agentB);
      expect(msgsA.find(m => m.triggerId === 'impulse')).toBeDefined();
      expect(msgsB).toHaveLength(0);
      vi.restoreAllMocks();
    });
  });

  // === Suite 10: Integration — Full Lifecycle ===

  describe('integration — full lifecycle', () => {
    it('should complete: start → chat → event → impulse → fire → deliver', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard({
        signals: [
          { type: 'idle', weight: 0.8, idleMinutes: 10 },
        ],
        fireThreshold: 0.3,
        cooldownMinutes: 1,
      });
      const agent = identity.createAgent('Lifecycle', card, 'enhanced');
      engine.setGenerateFn(async () => 'lifecycle message');
      engine.start(agent.id);

      // Simulate chat activity
      await engine.onResponse('ok', ctx(agent.id, '你好'));
      expect(engine.getImpulseState(agent.id)!.activeEvents).toHaveLength(0);

      // Simulate emotional event
      await engine.onResponse('ok', ctx(agent.id, '好孤独啊'));
      expect(engine.getImpulseState(agent.id)!.activeEvents.find(e => e.name === 'loneliness')).toBeDefined();

      // Advance time for idle accumulation
      engine.advanceTime(30);
      setImpulseValue(engine, agent.id, 0.5);
      await engine.evaluateAll(agent.id);

      // Check message was generated and can be delivered
      const msgs = engine.getPendingMessages(agent.id);
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      engine.markDelivered(msgs[0].id);
      expect(engine.getPendingMessages(agent.id).length).toBeLessThan(msgs.length);
      vi.restoreAllMocks();
    });

    it('should preserve pending messages across stop/start (DB-backed)', async () => {
      const agent = identity.createAgent('Persist', proactiveCard, 'enhanced');
      engine.setGenerateFn(async () => 'persistent msg');
      engine.start(agent.id);
      engine.advanceTime(6);
      await engine.evaluateAll(agent.id);
      expect(engine.getPendingMessages(agent.id)).toHaveLength(1);

      // Stop and restart
      engine.stop(agent.id);
      engine.start(agent.id);
      // Messages are in DB, should still be retrievable
      expect(engine.getPendingMessages(agent.id)).toHaveLength(1);
    });
  });

  // === Suite 11: Event Decay ===

  describe('event decay', () => {
    it('should decay event intensity exponentially', async () => {
      const card = makeImpulseCard();
      const agent = identity.createAgent('Decay1', card, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'test-decay', 0.8, 1.0); // decayRate=1.0/hour
      const initial = engine.getImpulseState(agent.id)!.activeEvents[0].intensity;
      expect(initial).toBe(0.8);

      // Advance 1 hour
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      const after1h = engine.getImpulseState(agent.id)!.activeEvents;
      if (after1h.length > 0) {
        // intensity × exp(-1.0 × 1) ≈ 0.8 × 0.368 ≈ 0.294
        expect(after1h[0].intensity).toBeLessThan(0.5);
        expect(after1h[0].intensity).toBeGreaterThan(0.1);
      }
    });

    it('should remove events when intensity drops below 0.05', async () => {
      const card = makeImpulseCard();
      const agent = identity.createAgent('Decay2', card, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'weak-event', 0.1, 2.0); // fast decay
      engine.advanceTime(120); // 2 hours with decayRate=2.0
      await engine.evaluateAll(agent.id);
      // 0.1 × exp(-2.0 × 2) ≈ 0.1 × 0.018 ≈ 0.002 < 0.05 → removed
      expect(engine.getImpulseState(agent.id)!.activeEvents).toHaveLength(0);
    });

    it('should compute eventGate as max of remaining event intensities', async () => {
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: 0 },
      ]);
      const agent = identity.createAgent('Decay3', card, 'enhanced');
      engine.start(agent.id);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      // Add two events with different intensities
      engine.addActiveEvent(agent.id, 'event-strong', 0.9, 0.1);
      engine.addActiveEvent(agent.id, 'event-weak', 0.3, 0.1);
      // eventGate should be max(0.9, 0.3) = 0.9
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      // With eventGate=0.9 and emotion_pattern activation=1, impulse should increase
      expect(engine.getImpulseState(agent.id)!.value).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // V2 Tests — Proactive Engine V2 Enhancements
  // ============================================================

  // === Suite 12: evaluateAll snapshot consistency ===

  describe('V2: evaluateAll snapshot consistency', () => {
    it('should record snapshot on manual evaluateAll call', async () => {
      const card: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.2/1m', prompt: 'snapshot test', cooldownMinutes: 60 },
          ],
        },
      };
      const agent = identity.createAgent('Snap1', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      engine.setGenerateFn(async () => 'snapshot fired');
      engine.start(agent.id); // snapshot #1
      // Manual evaluateAll should record snapshot #2
      await engine.evaluateAll(agent.id);
      // Another manual call records snapshot #3
      await engine.evaluateAll(agent.id);
      // Now we have 3 snapshots — sustained trigger should work
      // (all snapshots satisfy pleasure < -0.2)
      const msgs = engine.getPendingMessages(agent.id);
      expect(msgs.find(m => m.triggerType === 'emotion')).toBeDefined();
    });

    it('should not fire sustained trigger with only start snapshot (no evaluateAll)', async () => {
      const card: MetroidCard = {
        ...proactiveCard,
        proactive: {
          enabled: true,
          triggers: [
            { type: 'emotion', condition: 'sustained:pleasure<-0.2/1m', prompt: 'no snap', cooldownMinutes: 60 },
          ],
        },
      };
      const agent = identity.createAgent('Snap2', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      engine.setGenerateFn(async () => 'should not fire');
      engine.start(agent.id); // only 1 snapshot
      // Don't call evaluateAll — only 1 snapshot, sustained needs ≥2
      expect(engine.getPendingMessages(agent.id)).toHaveLength(0);
    });
  });

  // === Suite 13: computeTrajectory ===

  describe('V2: computeTrajectory', () => {
    it('should detect rising trajectory', () => {
      const agent = identity.createAgent('Traj1', proactiveCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.3, arousal: 0, dominance: 0 };
      engine.start(agent.id); // snapshot at pleasure=-0.3
      engine.advanceTime(30);
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.3, arousal: 0, dominance: 0 };
      // Record another snapshot via evaluateAll
      engine.evaluateAll(agent.id);
      const traj = engine.computeTrajectory(agent.id);
      expect(traj.pleasure.direction).toBe('rising');
      expect(traj.pleasure.delta).toBeGreaterThan(0.05);
    });

    it('should detect falling trajectory', () => {
      const agent = identity.createAgent('Traj2', proactiveCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0, dominance: 0 };
      engine.start(agent.id);
      engine.advanceTime(30);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.2, arousal: 0, dominance: 0 };
      engine.evaluateAll(agent.id);
      const traj = engine.computeTrajectory(agent.id);
      expect(traj.pleasure.direction).toBe('falling');
      expect(traj.pleasure.delta).toBeLessThan(-0.05);
    });

    it('should detect stable trajectory', () => {
      const agent = identity.createAgent('Traj3', proactiveCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.1, arousal: 0, dominance: 0 };
      engine.start(agent.id);
      engine.advanceTime(30);
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.12, arousal: 0, dominance: 0 };
      engine.evaluateAll(agent.id);
      const traj = engine.computeTrajectory(agent.id);
      expect(traj.pleasure.direction).toBe('stable');
    });
  });

  // === Suite 14: event relevance ===

  describe('V2: event relevance', () => {
    it('should store relevance on active events', () => {
      const agent = identity.createAgent('Rel1', impulseCard, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'test', 0.8, 0.5, 0.9);
      const state = engine.getImpulseState(agent.id)!;
      expect(state.activeEvents[0].relevance).toBe(0.9);
    });

    it('should default relevance to 0.8', () => {
      const agent = identity.createAgent('Rel2', impulseCard, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'test', 0.8);
      const state = engine.getImpulseState(agent.id)!;
      expect(state.activeEvents[0].relevance).toBe(0.8);
    });

    it('should use intensity×relevance for eventGate', async () => {
      // High intensity but low relevance → lower eventGate
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: 0 },
      ]);
      const agent = identity.createAgent('Rel3', card, 'enhanced');
      engine.start(agent.id);
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      // intensity=0.8, relevance=0.1 → eventGate = 0.08
      engine.addActiveEvent(agent.id, 'low-rel', 0.8, 0.5, 0.1);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      const val = engine.getImpulseState(agent.id)!.value;
      // eventGate = 0.08, so gain is very small
      expect(val).toBeLessThan(0.1);
    });
  });

  // === Suite 15: emotion_pressure signal ===

  describe('V2: emotion_pressure signal', () => {
    function makePressureCard(): MetroidCard {
      return {
        ...proactiveCard,
        name: 'PressureBot',
        emotion: {
          baseline: { pleasure: 0, arousal: 0, dominance: 0 },
          intensityDial: 0.8,
          expressiveness: 0.8,
          restraint: 0.2,
        },
        proactive: {
          enabled: true,
          triggers: [],
          impulse: {
            enabled: true,
            signals: [
              { type: 'emotion_pressure', weight: 1.0 },
            ],
            decayRate: 0.01,
            fireThreshold: 0.6,
            cooldownMinutes: 10,
            promptTemplate: 'pressure test',
          },
        },
      };
    }

    it('should accumulate impulse from emotion pressure without events', async () => {
      const card = makePressureCard();
      const agent = identity.createAgent('Press1', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.8, arousal: 0.5, dominance: 0 };
      engine.start(agent.id);
      // No active events — emotion_pressure bypasses eventGate
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBeGreaterThan(0);
    });

    it('should return 0 activation when emotion is at baseline', async () => {
      const card = makePressureCard();
      const agent = identity.createAgent('Press2', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0, arousal: 0, dominance: 0 };
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      expect(engine.getImpulseState(agent.id)!.value).toBe(0);
    });

    it('should increase activation with distance from baseline', async () => {
      const card = makePressureCard();
      const agentNear = identity.createAgent('Press3a', card, 'enhanced');
      const agentFar = identity.createAgent('Press3b', card, 'enhanced');
      identity.getAgent(agentNear.id)!.emotionState = { pleasure: -0.2, arousal: 0, dominance: 0 };
      identity.getAgent(agentFar.id)!.emotionState = { pleasure: -0.8, arousal: 0.5, dominance: -0.3 };
      engine.start(agentNear.id);
      engine.start(agentFar.id);
      setImpulseValue(engine, agentNear.id, 0);
      setImpulseValue(engine, agentFar.id, 0);
      engine.advanceTime(60);
      await engine.evaluateAll(agentNear.id);
      await engine.evaluateAll(agentFar.id);
      expect(engine.getImpulseState(agentFar.id)!.value).toBeGreaterThan(
        engine.getImpulseState(agentNear.id)!.value
      );
    });

    it('should fire impulse from pure emotion pressure', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makePressureCard();
      const agent = identity.createAgent('Press4', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.9, arousal: 0.7, dominance: -0.5 };
      engine.setGenerateFn(async () => 'pressure fired');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.7);
      await engine.evaluateAll(agent.id);
      const msgs = engine.getPendingMessages(agent.id);
      expect(msgs.find(m => m.triggerId === 'impulse')).toBeDefined();
      vi.restoreAllMocks();
    });
  });

  // === Suite 16: long-term mood ===

  describe('V2: long-term mood', () => {
    it('should persist long-term mood on stop', () => {
      const card: MetroidCard = {
        ...impulseCard,
        emotion: {
          ...impulseCard.emotion!,
          moodInertia: 0.5,
          longTermDimensions: ['attachment', 'trust'],
        },
      };
      const agent = identity.createAgent('LTM1', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.6, arousal: 0.4, dominance: 0.2 };
      engine.start(agent.id);
      // Record some snapshots
      engine.advanceTime(10);
      engine.evaluateAll(agent.id);
      engine.advanceTime(10);
      engine.evaluateAll(agent.id);
      // Stop triggers updateLongTermMood
      engine.stop(agent.id);
      const mood = engine.getLongTermMood(agent.id);
      expect(mood.attachment).toBeDefined();
      expect(mood.trust).toBeDefined();
      expect(typeof mood.attachment).toBe('number');
    });

    it('should apply EMA with moodInertia', () => {
      const card: MetroidCard = {
        ...impulseCard,
        emotion: {
          ...impulseCard.emotion!,
          moodInertia: 0.5, // α = 0.5
          longTermDimensions: ['attachment'],
        },
      };
      const agent = identity.createAgent('LTM2', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.8, arousal: 0.8, dominance: 0 };
      engine.start(agent.id);
      engine.advanceTime(10);
      engine.evaluateAll(agent.id);
      engine.stop(agent.id);
      const mood1 = engine.getLongTermMood(agent.id);
      // First session: L = 0.5 * sessionAvg + 0.5 * 0 = 0.5 * sessionAvg
      expect(mood1.attachment).toBeGreaterThan(0);

      // Second session with different emotion
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: -0.5, dominance: 0 };
      engine.start(agent.id);
      engine.advanceTime(10);
      engine.evaluateAll(agent.id);
      engine.stop(agent.id);
      const mood2 = engine.getLongTermMood(agent.id);
      // Should have moved toward negative
      expect(mood2.attachment).toBeLessThan(mood1.attachment);
    });

    it('should read empty mood for new agent', () => {
      const agent = identity.createAgent('LTM3', impulseCard, 'enhanced');
      const mood = engine.getLongTermMood(agent.id);
      expect(Object.keys(mood)).toHaveLength(0);
    });

    it('should use default dimensions when not configured', () => {
      const agent = identity.createAgent('LTM4', impulseCard, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0.3, dominance: 0.1 };
      engine.start(agent.id);
      engine.advanceTime(10);
      engine.evaluateAll(agent.id);
      engine.stop(agent.id);
      const mood = engine.getLongTermMood(agent.id);
      // Default dimensions: attachment, trust
      expect(mood.attachment).toBeDefined();
      expect(mood.trust).toBeDefined();
    });

    it('should handle multiple stop/start cycles', () => {
      const card: MetroidCard = {
        ...impulseCard,
        emotion: {
          ...impulseCard.emotion!,
          moodInertia: 0.8,
          longTermDimensions: ['attachment'],
        },
      };
      const agent = identity.createAgent('LTM5', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0.5, dominance: 0 };
      for (let i = 0; i < 3; i++) {
        engine.start(agent.id);
        engine.advanceTime(5);
        engine.evaluateAll(agent.id);
        engine.stop(agent.id);
      }
      const mood = engine.getLongTermMood(agent.id);
      expect(mood.attachment).toBeGreaterThan(0);
    });
  });

  // === Suite 17: event cooldown ===

  describe('V2: event cooldown', () => {
    it('should reduce intensity for duplicate event within 10 minutes', () => {
      const agent = identity.createAgent('Cool1', impulseCard, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'loneliness', 0.5);
      // Same event again immediately (within 10 min)
      engine.addActiveEvent(agent.id, 'loneliness', 0.8);
      const state = engine.getImpulseState(agent.id)!;
      // New intensity = max(0.5, 0.8 * 0.5) = max(0.5, 0.4) = 0.5
      expect(state.activeEvents[0].intensity).toBe(0.5);
    });

    it('should not reduce intensity for event after 10 minutes', () => {
      const agent = identity.createAgent('Cool2', impulseCard, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'loneliness', 0.5);
      engine.advanceTime(11); // past 10 min cooldown
      engine.addActiveEvent(agent.id, 'loneliness', 0.8);
      const state = engine.getImpulseState(agent.id)!;
      // No cooldown penalty → max(0.5, 0.8) = 0.8
      expect(state.activeEvents[0].intensity).toBe(0.8);
    });

    it('should not affect different event names', () => {
      const agent = identity.createAgent('Cool3', impulseCard, 'enhanced');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'loneliness', 0.5);
      engine.addActiveEvent(agent.id, 'farewell', 0.8);
      const state = engine.getImpulseState(agent.id)!;
      expect(state.activeEvents).toHaveLength(2);
      expect(state.activeEvents.find(e => e.name === 'farewell')!.intensity).toBe(0.8);
    });
  });

  // === Suite 18: fireImpulse prompt V2 ===

  describe('V2: fireImpulse prompt structure', () => {
    it('should include emotion_trajectory section', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Prompt1', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.3, arousal: 0.2, dominance: 0 };
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test'; });
      engine.start(agent.id);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('<emotion_trajectory>');
      expect(capturedPrompt).toContain('pleasure:');
      expect(capturedPrompt).toContain('arousal:');
      expect(capturedPrompt).toContain('dominance:');
      expect(capturedPrompt).toContain('</emotion_trajectory>');
      vi.restoreAllMocks();
    });

    it('should include active_events with relevance labels', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Prompt2', card, 'enhanced');
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test'; });
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'farewell', 0.8, 0.5, 0.9);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('<active_events>');
      expect(capturedPrompt).toContain('farewell');
      expect(capturedPrompt).toContain('高度相关');
      vi.restoreAllMocks();
    });

    it('should include suppression count when suppressed', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Prompt3', card, 'enhanced');
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test'; });
      engine.start(agent.id);
      const state = engine.getImpulseState(agent.id)!;
      state.suppressionCount = 3;
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('已抑制: 3次');
      vi.restoreAllMocks();
    });

    it('should include idle duration in trigger_context', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Prompt4', card, 'enhanced');
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test'; });
      engine.start(agent.id);
      engine.advanceTime(45); // 45 min idle
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('沉默时长: 45分钟');
      vi.restoreAllMocks();
    });

    it('should include long_term_mood when available', async () => {
      let capturedPrompt = '';
      const card: MetroidCard = {
        ...makeImpulseCard(),
        emotion: {
          baseline: { pleasure: 0, arousal: 0, dominance: 0 },
          intensityDial: 0.8,
          expressiveness: 0.8,
          restraint: 0.2,
          moodInertia: 0.5,
          longTermDimensions: ['attachment'],
        },
      };
      const agent = identity.createAgent('Prompt5', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0.5, dominance: 0 };
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test'; });
      engine.start(agent.id);
      engine.advanceTime(5);
      engine.evaluateAll(agent.id);
      // Stop to persist mood, then restart
      engine.stop(agent.id);
      engine.start(agent.id);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).toContain('<long_term_mood>');
      expect(capturedPrompt).toContain('attachment');
      vi.restoreAllMocks();
    });

    it('should omit long_term_mood section when empty', async () => {
      let capturedPrompt = '';
      const card = makeImpulseCard();
      const agent = identity.createAgent('Prompt6', card, 'enhanced');
      engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'test'; });
      engine.start(agent.id);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      expect(capturedPrompt).not.toContain('<long_term_mood>');
      vi.restoreAllMocks();
    });
  });

  // === Suite 19: triggerType refinement ===

  describe('V2: triggerType refinement', () => {
    it('should return impulse:idle for idle-only signals', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeImpulseCard({
        signals: [{ type: 'idle', weight: 1.0, idleMinutes: 30 }],
      });
      const agent = identity.createAgent('TT1', card, 'enhanced');
      engine.setGenerateFn(async () => 'idle trigger');
      engine.start(agent.id);
      engine.advanceTime(60);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msg = engine.getPendingMessages(agent.id).find(m => m.triggerId === 'impulse');
      expect(msg).toBeDefined();
      expect(msg!.triggerType).toBe('impulse:idle');
      vi.restoreAllMocks();
    });

    it('should return impulse:emotion for emotion_pressure-only signals', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card: MetroidCard = {
        ...proactiveCard,
        name: 'TT2Bot',
        emotion: {
          baseline: { pleasure: 0, arousal: 0, dominance: 0 },
          intensityDial: 0.8,
          expressiveness: 0.8,
          restraint: 0.2,
        },
        proactive: {
          enabled: true,
          triggers: [],
          impulse: {
            enabled: true,
            signals: [{ type: 'emotion_pressure', weight: 1.0 }],
            decayRate: 0.01,
            fireThreshold: 0.6,
            cooldownMinutes: 10,
            promptTemplate: 'emotion trigger type test',
          },
        },
      };
      const agent = identity.createAgent('TT2', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.8, arousal: 0.5, dominance: 0 };
      engine.setGenerateFn(async () => 'emotion trigger');
      engine.start(agent.id);
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msg = engine.getPendingMessages(agent.id).find(m => m.triggerId === 'impulse');
      expect(msg).toBeDefined();
      expect(msg!.triggerType).toBe('impulse:emotion');
      vi.restoreAllMocks();
    });

    it('should return impulse:mixed for balanced signals', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card: MetroidCard = {
        ...proactiveCard,
        name: 'TT3Bot',
        emotion: {
          baseline: { pleasure: 0, arousal: 0, dominance: 0 },
          intensityDial: 0.8,
          expressiveness: 0.8,
          restraint: 0.2,
        },
        proactive: {
          enabled: true,
          triggers: [],
          impulse: {
            enabled: true,
            signals: [
              { type: 'idle', weight: 0.5, idleMinutes: 30 },
              { type: 'emotion_pressure', weight: 0.5 },
            ],
            decayRate: 0.01,
            fireThreshold: 0.6,
            cooldownMinutes: 10,
            promptTemplate: 'mixed trigger type test',
          },
        },
      };
      const agent = identity.createAgent('TT3', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.8, arousal: 0.5, dominance: 0 };
      engine.setGenerateFn(async () => 'mixed trigger');
      engine.start(agent.id);
      engine.advanceTime(60); // idle fully active
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msg = engine.getPendingMessages(agent.id).find(m => m.triggerId === 'impulse');
      expect(msg).toBeDefined();
      expect(msg!.triggerType).toBe('impulse:mixed');
      vi.restoreAllMocks();
    });

    it('should return impulse:emotion for emotion_pattern with events', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const card = makeEmotionPatternCard([
        { axis: 'pleasure', op: '<', value: 0 },
      ]);
      // Override impulse config
      card.proactive!.impulse!.cooldownMinutes = 1;
      const agent = identity.createAgent('TT4', card, 'enhanced');
      identity.getAgent(agent.id)!.emotionState = { pleasure: -0.5, arousal: 0, dominance: 0 };
      engine.setGenerateFn(async () => 'emotion pattern trigger');
      engine.start(agent.id);
      engine.addActiveEvent(agent.id, 'test', 0.8);
      setImpulseValue(engine, agent.id, 0.5);
      engine.advanceTime(60);
      await engine.evaluateAll(agent.id);
      const msg = engine.getPendingMessages(agent.id).find(m => m.triggerId === 'impulse');
      expect(msg).toBeDefined();
      expect(msg!.triggerType).toBe('impulse:emotion');
      vi.restoreAllMocks();
    });
  });

  // ============================================================
  // V3: Message Deduplication Tests
  // ============================================================

  describe('V3: Message Deduplication', () => {
    let db: Database.Database;
    let identity: IdentityEngine;
    let emotion: EmotionEngine;
    let audit: AuditLog;
    let engine: ProactiveEngine;
    let agent: any;

    beforeEach(() => {
      db = createTestDb();
      identity = new IdentityEngine(db);
      audit = new AuditLog(db);
      emotion = new EmotionEngine(db, identity, audit, testConfig as any);
      engine = new ProactiveEngine(db, identity, emotion, audit, testConfig as any);
      agent = identity.createAgent('DedupBot', proactiveCard, 'enhanced');
      engine.start(agent.id);
    });

    afterEach(() => {
      engine.stop();
      db.close();
    });

    it('should detect duplicate via bigram Jaccard (no embedding)', async () => {
      // Insert a message manually
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 0)`).run('msg-1', agent.id, '今天天气真好，出去走走吧');

      const dup = await engine.isDuplicate(agent.id, '今天天气真好，出去走走吧！');
      expect(dup).toBe(true);
    });

    it('should allow semantically different messages', async () => {
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 0)`).run('msg-2', agent.id, '今天天气真好，出去走走吧');

      const dup = await engine.isDuplicate(agent.id, '你最近在看什么书？');
      expect(dup).toBe(false);
    });

    it('should check against recently delivered messages', async () => {
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, created_at)
        VALUES (?, ?, 'test', 'idle', ?, 1, datetime('now'))`).run('msg-3', agent.id, '想你了，在干嘛呢');

      const dup = await engine.isDuplicate(agent.id, '想你了，在干嘛呢？');
      expect(dup).toBe(true);
    });

    it('should return false when no existing messages', async () => {
      const dup = await engine.isDuplicate(agent.id, '你好呀');
      expect(dup).toBe(false);
    });

    it('should not cross-contaminate between agents', async () => {
      const agent2 = identity.createAgent('DedupBot2', proactiveCard, 'enhanced');
      engine.start(agent2.id);

      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 0)`).run('msg-4', agent.id, '今天天气真好');

      const dup = await engine.isDuplicate(agent2.id, '今天天气真好');
      expect(dup).toBe(false);
    });

    it('should skip duplicate in fireTrigger', async () => {
      const generated = vi.fn().mockResolvedValue('今天天气真好，出去走走吧');
      engine.setGenerateFn(generated);

      // Pre-insert a similar message
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 0)`).run('msg-5', agent.id, '今天天气真好，出去走走吧');

      // Fire event trigger
      await engine.fireEvent(agent.id, 'birthday');
      // The generated message should be duplicate, so no new message beyond the pre-inserted one
      const pending = engine.getPendingMessages(agent.id);
      expect(pending.length).toBe(1); // only the pre-inserted one
    });

    it('should skip duplicate in fireImpulse', async () => {
      const card = makeImpulseCard();
      const impAgent = identity.createAgent('DedupImpulse', card, 'enhanced');
      engine.start(impAgent.id);

      const generated = vi.fn().mockResolvedValue('想你了，在干嘛呢');
      engine.setGenerateFn(generated);

      // Pre-insert a similar message
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'impulse:idle', ?, 0)`).run('msg-6', impAgent.id, '想你了，在干嘛呢');

      // Force impulse to fire
      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, impAgent.id, 0.9);
      engine.advanceTime(60);
      await engine.evaluateAll(impAgent.id);

      const pending = engine.getPendingMessages(impAgent.id);
      // Should only have the pre-inserted one, not a duplicate
      expect(pending.length).toBe(1);
      vi.restoreAllMocks();
    });

    it('bigram Jaccard handles empty strings', async () => {
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 0)`).run('msg-7', agent.id, 'a');

      // Very short strings — should not crash
      const dup = await engine.isDuplicate(agent.id, 'b');
      expect(typeof dup).toBe('boolean');
    });
  });

  // ============================================================
  // V3: User Feedback Loop Tests
  // ============================================================

  describe('V3: User Feedback Loop', () => {
    let db: Database.Database;
    let identity: IdentityEngine;
    let emotion: EmotionEngine;
    let audit: AuditLog;
    let engine: ProactiveEngine;
    let agent: any;

    beforeEach(() => {
      db = createTestDb();
      identity = new IdentityEngine(db);
      audit = new AuditLog(db);
      emotion = new EmotionEngine(db, identity, audit, testConfig as any);
      engine = new ProactiveEngine(db, identity, emotion, audit, testConfig as any);
      agent = identity.createAgent('FeedbackBot', impulseCard, 'enhanced');
      engine.start(agent.id);
    });

    afterEach(() => {
      engine.stop();
      db.close();
    });

    it('should record engaged reaction when user replies within 30 min', async () => {
      // Insert a delivered message with delivered_at
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, delivered_at)
        VALUES (?, ?, 'test', 'idle', ?, 1, datetime('now', '-5 minutes'))`).run('fb-1', agent.id, 'Hello!');

      // Simulate user response
      await engine.onResponse('user reply', ctx(agent.id, 'Thanks!'));

      const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE message_id = ?').all('fb-1') as any[];
      expect(reactions.length).toBe(1);
      expect(reactions[0].reaction).toBe('engaged');
      expect(reactions[0].response_latency_ms).toBeGreaterThan(0);
    });

    it('should mark stale messages as ignored after 30 min', async () => {
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, delivered_at)
        VALUES (?, ?, 'test', 'idle', ?, 1, datetime('now', '-45 minutes'))`).run('fb-2', agent.id, 'Hello!');

      await engine.evaluateAll(agent.id);

      const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE message_id = ?').all('fb-2') as any[];
      expect(reactions.length).toBe(1);
      expect(reactions[0].reaction).toBe('ignored');
    });

    it('should not double-record reactions', async () => {
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, delivered_at)
        VALUES (?, ?, 'test', 'idle', ?, 1, datetime('now', '-5 minutes'))`).run('fb-3', agent.id, 'Hello!');

      await engine.onResponse('reply 1', ctx(agent.id, 'Hi'));
      await engine.onResponse('reply 2', ctx(agent.id, 'How are you'));

      const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE message_id = ?').all('fb-3') as any[];
      expect(reactions.length).toBe(1); // only first reaction recorded
    });

    it('should use default threshold when no preferences exist', () => {
      const threshold = engine.getAdaptiveThreshold(agent.id);
      expect(threshold).toBeNull();
    });

    it('should store and retrieve preferences', () => {
      engine.updatePreferences(agent.id); // no data yet, should be no-op

      // Manually insert some reactions to trigger preference update
      for (let i = 0; i < 10; i++) {
        const msgId = `pref-msg-${i}`;
        db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, delivered_at)
          VALUES (?, ?, 'test', 'impulse:idle', ?, 1, datetime('now', '-${i} minutes'))`).run(msgId, agent.id, `msg ${i}`);
        db.prepare(`INSERT INTO proactive_reactions (agent_id, message_id, reaction)
          VALUES (?, ?, ?)`).run(agent.id, msgId, i < 8 ? 'engaged' : 'ignored');
      }

      engine.updatePreferences(agent.id);
      const threshold = engine.getAdaptiveThreshold(agent.id);
      expect(threshold).not.toBeNull();
      expect(threshold!).toBeLessThan(testConfig.proactive.impulseFireThreshold); // high engagement → lower threshold
    });

    it('should raise threshold when engagement is low', () => {
      for (let i = 0; i < 10; i++) {
        const msgId = `low-msg-${i}`;
        db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, delivered_at)
          VALUES (?, ?, 'test', 'impulse:idle', ?, 1, datetime('now', '-${i} minutes'))`).run(msgId, agent.id, `msg ${i}`);
        db.prepare(`INSERT INTO proactive_reactions (agent_id, message_id, reaction)
          VALUES (?, ?, ?)`).run(agent.id, msgId, i < 2 ? 'engaged' : 'ignored');
      }

      engine.updatePreferences(agent.id);
      const threshold = engine.getAdaptiveThreshold(agent.id);
      expect(threshold).not.toBeNull();
      expect(threshold!).toBeGreaterThan(testConfig.proactive.impulseFireThreshold); // low engagement → higher threshold
    });

    it('should record manual reaction', () => {
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 1)`).run('fb-manual', agent.id, 'Hello!');

      engine.recordReaction(agent.id, 'fb-manual', 'dismissed', 5000, 0);

      const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE message_id = ?').all('fb-manual') as any[];
      expect(reactions.length).toBe(1);
      expect(reactions[0].reaction).toBe('dismissed');
    });

    it('should isolate preferences between agents', () => {
      const agent2 = identity.createAgent('FeedbackBot2', impulseCard, 'enhanced');
      engine.start(agent2.id);

      // Set preference for agent1
      for (let i = 0; i < 10; i++) {
        const msgId = `iso-msg-${i}`;
        db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered, delivered_at)
          VALUES (?, ?, 'test', 'impulse:idle', ?, 1, datetime('now', '-${i} minutes'))`).run(msgId, agent.id, `msg ${i}`);
        db.prepare(`INSERT INTO proactive_reactions (agent_id, message_id, reaction)
          VALUES (?, ?, 'engaged')`).run(agent.id, msgId);
      }
      engine.updatePreferences(agent.id);

      // Agent2 should have no preferences
      expect(engine.getAdaptiveThreshold(agent2.id)).toBeNull();
    });

    it('markDelivered should set delivered_at', () => {
      const generated = vi.fn().mockResolvedValue('Hello there!');
      engine.setGenerateFn(generated);

      // Insert a pending message
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'idle', ?, 0)`).run('del-1', agent.id, 'Hello!');

      engine.markDelivered('del-1');

      const row = db.prepare('SELECT delivered, delivered_at FROM proactive_messages WHERE id = ?').get('del-1') as any;
      expect(row.delivered).toBe(1);
      expect(row.delivered_at).not.toBeNull();
    });

    it('should apply adaptive threshold in evaluateImpulse', async () => {
      // Set a very high adaptive threshold
      db.prepare(`INSERT INTO proactive_preferences (agent_id, key, value) VALUES (?, 'fire_threshold', 0.99)`).run(agent.id);

      const generated = vi.fn().mockResolvedValue('Hello!');
      engine.setGenerateFn(generated);

      vi.spyOn(Math, 'random').mockReturnValue(0);
      setImpulseValue(engine, agent.id, 0.95); // below 0.99 but above default 0.6
      // Don't advance time — idle activation stays near 0, so impulse won't gain enough to exceed 0.99
      await engine.evaluateAll(agent.id);

      // Should NOT fire because impulse (0.95) < adaptive threshold (0.99)
      expect(generated).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });

  // ============================================================
  // V3: Context-Aware Event Detection Tests
  // ============================================================

  describe('V3: Context-Aware Event Detection', () => {
    let db: Database.Database;
    let identity: IdentityEngine;
    let emotion: EmotionEngine;
    let audit: AuditLog;
    let engine: ProactiveEngine;
    let agent: any;

    beforeEach(() => {
      db = createTestDb();
      identity = new IdentityEngine(db);
      audit = new AuditLog(db);
      emotion = new EmotionEngine(db, identity, audit, testConfig as any);
      engine = new ProactiveEngine(db, identity, emotion, audit, testConfig as any);
      agent = identity.createAgent('EventBot', impulseCard, 'enhanced');
      engine.start(agent.id);
    });

    afterEach(() => {
      engine.stop();
      db.close();
    });

    it('should confirm regex candidates via LLM', async () => {
      const analyzeFn = vi.fn().mockResolvedValue(JSON.stringify({
        events: [{ name: 'farewell', confirmed: true, intensity: 0.9, relevance: 0.9, confidence: 0.95, reason: 'User said goodbye' }],
        new_events: [],
      }));
      engine.setAnalyzeFn(analyzeFn);

      const results = await engine.detectEventsWithLLM(
        agent.id, '再见了，我要出国了',
        [{ name: 'farewell', intensity: 0.8, relevance: 0.9 }],
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      const farewell = results.find(e => e.name === 'farewell');
      expect(farewell).toBeDefined();
      expect(farewell!.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should reject false positive via LLM', async () => {
      const analyzeFn = vi.fn().mockResolvedValue(JSON.stringify({
        events: [{ name: 'loneliness', confirmed: false, confidence: 0.1, reason: 'Just a metaphor' }],
        new_events: [],
      }));
      engine.setAnalyzeFn(analyzeFn);

      const results = await engine.detectEventsWithLLM(
        agent.id, '我一个人吃了整个蛋糕',
        [{ name: 'loneliness', intensity: 0.5, relevance: 0.7 }],
      );

      const loneliness = results.find(e => e.name === 'loneliness');
      expect(loneliness).toBeUndefined();
    });

    it('should discover new events via LLM', async () => {
      const analyzeFn = vi.fn().mockResolvedValue(JSON.stringify({
        events: [{ name: 'farewell', confirmed: true, intensity: 0.8, relevance: 0.9, confidence: 0.9 }],
        new_events: [{ name: 'anxiety', intensity: 0.6, relevance: 0.7, confidence: 0.8, reason: 'User worried about future' }],
      }));
      engine.setAnalyzeFn(analyzeFn);

      const results = await engine.detectEventsWithLLM(
        agent.id, '再见了，我好担心以后的生活',
        [{ name: 'farewell', intensity: 0.8, relevance: 0.9 }],
      );

      expect(results.length).toBe(2);
      expect(results.find(e => e.name === 'anxiety')).toBeDefined();
    });

    it('should fallback to regex when LLM fails', async () => {
      const analyzeFn = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
      engine.setAnalyzeFn(analyzeFn);

      const candidates = [{ name: 'farewell', intensity: 0.8, relevance: 0.9 }];
      const results = await engine.detectEventsWithLLM(agent.id, '再见', candidates);

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('farewell');
      expect(results[0].confidence).toBe(0.6); // fallback confidence
    });

    it('should filter low-confidence events', async () => {
      const analyzeFn = vi.fn().mockResolvedValue(JSON.stringify({
        events: [{ name: 'conflict', confirmed: true, intensity: 0.7, relevance: 0.8, confidence: 0.3 }],
        new_events: [{ name: 'anxiety', intensity: 0.5, relevance: 0.5, confidence: 0.2 }],
      }));
      engine.setAnalyzeFn(analyzeFn);

      const results = await engine.detectEventsWithLLM(
        agent.id, '生气',
        [{ name: 'conflict', intensity: 0.7, relevance: 0.8 }],
      );

      // Both should be filtered (confidence < 0.5)
      expect(results.length).toBe(0);
    });

    it('should auto-confirm events not marked for LLM verify', async () => {
      // 'celebration' has llmVerify: false
      const analyzeFn = vi.fn();
      engine.setAnalyzeFn(analyzeFn);

      const results = await engine.detectEventsWithLLM(
        agent.id, '生日快乐',
        [{ name: 'celebration', intensity: 0.7, relevance: 0.8 }],
      );

      // Should auto-confirm without calling LLM
      expect(analyzeFn).not.toHaveBeenCalled();
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('celebration');
      expect(results[0].confidence).toBe(0.8);
    });

    it('should use regex results when no analyzeFn set', async () => {
      // Don't set analyzeFn
      const results = await engine.detectEventsWithLLM(
        agent.id, '再见',
        [{ name: 'farewell', intensity: 0.8, relevance: 0.9 }],
      );

      expect(results.length).toBe(1);
      expect(results[0].confidence).toBe(0.6); // default confidence
    });

    it('should detect new V3 event patterns', async () => {
      // Test new patterns added in V3
      await engine.onResponse('', ctx(agent.id, '烦死了，什么都不顺'));
      const state = engine.getImpulseState(agent.id);
      const frustration = state?.activeEvents.find(e => e.name === 'frustration');
      expect(frustration).toBeDefined();
    });

    it('should detect anxiety pattern', async () => {
      await engine.onResponse('', ctx(agent.id, '我好焦虑，明天的考试怎么办'));
      const state = engine.getImpulseState(agent.id);
      const anxiety = state?.activeEvents.find(e => e.name === 'anxiety');
      expect(anxiety).toBeDefined();
    });

    it('ActiveEvent should include confidence field', () => {
      engine.addActiveEvent(agent.id, 'test-event', 0.8, 0.5, 0.9, 0.75);
      const state = engine.getImpulseState(agent.id);
      const event = state?.activeEvents.find(e => e.name === 'test-event');
      expect(event).toBeDefined();
      expect(event!.confidence).toBe(0.75);
    });
  });

  // ============================================================
  // V3: End-to-End Lifecycle Tests
  // ============================================================

  describe('V3: End-to-End Lifecycle', () => {
    let db: Database.Database;
    let identity: IdentityEngine;
    let emotion: EmotionEngine;
    let audit: AuditLog;
    let engine: ProactiveEngine;

    beforeEach(() => {
      db = createTestDb();
      identity = new IdentityEngine(db);
      audit = new AuditLog(db);
      emotion = new EmotionEngine(db, identity, audit, testConfig as any);
      engine = new ProactiveEngine(db, identity, emotion, audit, testConfig as any);
    });

    afterEach(() => {
      engine.stop();
      db.close();
    });

    // --- Test 1: Full lifecycle — event → generate → deliver → feedback → threshold adjust ---

    it('full lifecycle: event → fire → deliver → engaged → threshold adjust', async () => {
      let callCount = 0;
      const card = makeImpulseCard({ cooldownMinutes: 0 }); // default fireThreshold=0.6
      const agent = identity.createAgent('E2E-1', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0); // mock AFTER createAgent
      // Use very distinct messages to avoid dedup (bigram Jaccard < 0.7)
      const phrases = [
        '今天的天气真不错，适合出去散步',
        '你最近有没有看什么好看的电影推荐',
        '我刚学会了一道新菜，想分享给你',
        '周末有什么计划吗？一起去爬山怎么样',
        '最近工作压力好大，需要放松一下',
        '你有没有听过这首歌？旋律特别好听',
        '我家的猫今天做了一件超搞笑的事',
        '昨天读了一本很棒的书，强烈推荐',
        '好想去旅行啊，你最想去哪个国家',
        '今天心情特别好，想和你聊聊天',
      ];
      engine.setGenerateFn(async () => phrases[callCount++ % phrases.length]);
      engine.start(agent.id);

      // Repeat 10 cycles: event → fire → deliver → user reply → engaged
      for (let i = 0; i < 10; i++) {
        // Trigger loneliness event
        await engine.onResponse('ok', ctx(agent.id, '好孤独啊'));
        expect(engine.getImpulseState(agent.id)!.activeEvents.find(e => e.name === 'loneliness')).toBeDefined();

        // Fire impulse (small advanceTime to ensure dtHours > 0)
        engine.advanceTime(1);
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);

        const msgs = engine.getPendingMessages(agent.id);
        const latest = msgs[msgs.length - 1];
        expect(latest).toBeDefined();

        // Deliver + manually set delivered_at to 5 min ago
        engine.markDelivered(latest.id);
        db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-5 minutes') WHERE id = ?`).run(latest.id);

        // User replies → engaged
        await engine.onResponse('好的谢谢', ctx(agent.id, '好的谢谢'));
        const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE message_id = ?').all(latest.id) as any[];
        expect(reactions.length).toBe(1);
        expect(reactions[0].reaction).toBe('engaged');

        // Reset cooldown for next cycle
        engine.getImpulseState(agent.id)!.lastFireTime = 0;
      }

      // After 10 engaged reactions, updatePreferences should adjust threshold
      engine.updatePreferences(agent.id);
      const threshold = engine.getAdaptiveThreshold(agent.id);
      expect(threshold).not.toBeNull();
      // High engagement (>70%) → threshold = max(0.3, 0.6 * 0.9) = 0.54 < 0.6
      expect(threshold!).toBeLessThan(0.6);

      vi.restoreAllMocks();
    });

    // --- Test 2: Dedup blocks duplicate but feedback loop still works ---

    it('dedup blocks duplicate message but feedback loop unaffected', async () => {
      const card = makeImpulseCard({ fireThreshold: 0.3, cooldownMinutes: 0 });
      const agent = identity.createAgent('E2E-2', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      // Always return same content
      engine.setGenerateFn(async () => '想你了');
      engine.start(agent.id);

      // First fire → message inserted
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msgs1 = engine.getPendingMessages(agent.id);
      const impulseMsg = msgs1.find(m => m.triggerId === 'impulse');
      expect(impulseMsg).toBeDefined();

      // Reset cooldown
      engine.getImpulseState(agent.id)!.lastFireTime = 0;

      // Second fire → duplicate, should be skipped
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msgs2 = engine.getPendingMessages(agent.id).filter(m => m.triggerId === 'impulse');
      expect(msgs2).toHaveLength(1); // still only 1

      // Deliver the first one and set delivered_at to 5 min ago
      engine.markDelivered(impulseMsg!.id);
      db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-5 minutes') WHERE id = ?`).run(impulseMsg!.id);
      await engine.onResponse('好开心', ctx(agent.id, '好开心'));

      const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE message_id = ?').all(impulseMsg!.id) as any[];
      expect(reactions.length).toBe(1);
      expect(reactions[0].reaction).toBe('engaged');

      vi.restoreAllMocks();
    });

    // --- Test 3: LLM event detection → impulse accumulation → adaptive threshold ---

    it('LLM event detection → impulse → adaptive threshold', async () => {
      let callCount = 0;
      const card = makeImpulseCard({ fireThreshold: 0.3, cooldownMinutes: 0 });
      const agent = identity.createAgent('E2E-3', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      engine.setGenerateFn(async () => `llm event msg ${++callCount}`);

      // Mock LLM: confirm farewell + discover anxiety
      const analyzeFn = vi.fn().mockResolvedValue(JSON.stringify({
        events: [{ name: 'farewell', confirmed: true, intensity: 0.9, relevance: 0.9, confidence: 0.95, reason: 'User said goodbye' }],
        new_events: [{ name: 'anxiety', intensity: 0.6, relevance: 0.7, confidence: 0.8, reason: 'User worried' }],
      }));
      engine.setAnalyzeFn(analyzeFn);
      engine.start(agent.id);

      // Trigger farewell via regex → LLM confirms + discovers anxiety
      await engine.onResponse('', ctx(agent.id, '再见了，我好担心'));
      // LLM detection is async (.then()) — flush microtasks
      await new Promise(r => setTimeout(r, 50));
      const state = engine.getImpulseState(agent.id)!;
      const farewell = state.activeEvents.find(e => e.name === 'farewell');
      expect(farewell).toBeDefined();

      // Fire with accumulated impulse
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);

      const msgs = engine.getPendingMessages(agent.id);
      expect(msgs.length).toBeGreaterThanOrEqual(1);

      // Set a high adaptive threshold and verify fire behavior changes
      db.prepare(`INSERT OR REPLACE INTO proactive_preferences (agent_id, key, value) VALUES (?, 'fire_threshold', 0.95)`).run(agent.id);
      engine.getImpulseState(agent.id)!.lastFireTime = 0;
      setImpulseValue(engine, agent.id, 0.9); // below 0.95
      await engine.evaluateAll(agent.id);
      // Should NOT fire a new message because 0.9 < adaptive threshold 0.95
      const msgsAfter = engine.getPendingMessages(agent.id).filter(m => m.triggerId === 'impulse');
      expect(msgsAfter.length).toBe(1); // still only the first one

      vi.restoreAllMocks();
    });

    // --- Test 4: Ignored messages raise threshold ---

    it('ignored messages raise subsequent fire threshold', async () => {
      const card = makeImpulseCard({ fireThreshold: 0.3, cooldownMinutes: 0 });
      const agent = identity.createAgent('E2E-4', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      // Use very distinct messages to avoid dedup
      const topics = ['天气', '电影', '音乐', '旅行', '美食', '运动', '读书', '游戏', '工作', '学习'];
      let callCount = 0;
      engine.setGenerateFn(async () => `今天聊聊${topics[callCount++ % topics.length]}的话题，你觉得怎么样？`);
      engine.start(agent.id);

      // Generate and deliver 10 messages with no user reply
      const msgIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        engine.advanceTime(1);
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        const msgs = engine.getPendingMessages(agent.id);
        const latest = msgs[msgs.length - 1];
        expect(latest).toBeDefined();
        engine.markDelivered(latest.id);
        msgIds.push(latest.id);
        engine.getImpulseState(agent.id)!.lastFireTime = 0;
      }

      // Manually set delivered_at to 45 min ago (SQLite datetime doesn't respect advanceTime)
      for (const id of msgIds) {
        db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-45 minutes') WHERE id = ?`).run(id);
      }

      // evaluateAll triggers markStaleAsIgnored
      await engine.evaluateAll(agent.id);

      const ignoredCount = (db.prepare(
        'SELECT COUNT(*) as cnt FROM proactive_reactions WHERE agent_id = ? AND reaction = ?'
      ).get(agent.id, 'ignored') as any).cnt;
      expect(ignoredCount).toBeGreaterThanOrEqual(1);

      // Update preferences → threshold should rise above base (0.3)
      engine.updatePreferences(agent.id);
      const threshold = engine.getAdaptiveThreshold(agent.id);
      expect(threshold).not.toBeNull();
      // Low engagement → threshold = baseThreshold * 1.15 = 0.3 * 1.15 = 0.345
      expect(threshold!).toBeGreaterThan(0.3);

      vi.restoreAllMocks();
    });

    // --- Test 5: Cross-agent isolation — feedback doesn't leak ---

    it('cross-agent isolation: feedback from one agent does not affect another', async () => {
      let callCount = 0;
      const card = makeImpulseCard({ fireThreshold: 0.3, cooldownMinutes: 0 });
      const agent1 = identity.createAgent('IsoAlpha', card, 'enhanced');
      // Small delay to ensure different Date.now() for unique agent IDs
      await new Promise(r => setTimeout(r, 5));
      const agent2 = identity.createAgent('IsoBeta', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0); // mock AFTER createAgent
      const topics1 = ['猫咪', '狗狗', '兔子', '仓鼠', '鹦鹉', '金鱼', '乌龟', '蜥蜴', '蛇', '蜘蛛'];
      const topics2 = ['苹果', '香蕉', '橙子', '葡萄', '草莓', '西瓜', '芒果', '桃子', '梨子', '樱桃'];
      engine.setGenerateFn(async () => {
        const idx = callCount++;
        return idx < 10
          ? `你喜欢${topics1[idx]}吗？它们真的很可爱呢`
          : `今天吃了${topics2[idx - 10]}，味道不错哦`;
      });
      engine.start(agent1.id);
      engine.start(agent2.id);

      // Agent1: fire → deliver → user replies → engaged (10 times)
      for (let i = 0; i < 10; i++) {
        engine.advanceTime(1);
        setImpulseValue(engine, agent1.id, 0.9);
        await engine.evaluateAll(agent1.id);
        const msgs = engine.getPendingMessages(agent1.id);
        const latest = msgs[msgs.length - 1];
        expect(latest).toBeDefined();
        engine.markDelivered(latest.id);
        db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-5 minutes') WHERE id = ?`).run(latest.id);
        await engine.onResponse('nice', ctx(agent1.id, '好的'));
        engine.getImpulseState(agent1.id)!.lastFireTime = 0;
      }

      // Agent2: fire → deliver → no reply → manually mark as ignored
      for (let i = 0; i < 10; i++) {
        engine.advanceTime(1);
        setImpulseValue(engine, agent2.id, 0.9);
        await engine.evaluateAll(agent2.id);
        const msgs = engine.getPendingMessages(agent2.id);
        const latest = msgs[msgs.length - 1];
        expect(latest).toBeDefined();
        engine.markDelivered(latest.id);
        db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-45 minutes') WHERE id = ?`).run(latest.id);
        engine.getImpulseState(agent2.id)!.lastFireTime = 0;
      }
      // Mark agent2's stale
      await engine.evaluateAll(agent2.id);

      engine.updatePreferences(agent1.id);
      engine.updatePreferences(agent2.id);

      const t1 = engine.getAdaptiveThreshold(agent1.id);
      const t2 = engine.getAdaptiveThreshold(agent2.id);

      // Agent1 (high engagement) → lower or equal threshold
      // Agent2 (low engagement) → higher threshold
      if (t1 !== null && t2 !== null) {
        expect(t2).toBeGreaterThan(t1);
      }
      // At minimum, agent2 should have raised threshold above base (0.3)
      expect(t2).not.toBeNull();
      expect(t2!).toBeGreaterThan(0.3);

      vi.restoreAllMocks();
    });

    // --- Test 6: Dedup + event detection combined — event injected but message deduped ---

    it('event detected and injected but generated message deduped', async () => {
      const card = makeImpulseCard({ fireThreshold: 0.3, cooldownMinutes: 0 });
      const agent = identity.createAgent('E2E-6', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      // Pre-insert a pending message with specific content
      db.prepare(`INSERT INTO proactive_messages (id, agent_id, trigger_id, trigger_type, content, delivered)
        VALUES (?, ?, 'test', 'impulse:idle', ?, 0)`).run('e2e6-pre', agent.id, '我理解你的感受');

      // generateFn returns same content as pre-inserted
      engine.setGenerateFn(async () => '我理解你的感受');
      engine.start(agent.id);

      // Trigger event via onResponse
      await engine.onResponse('', ctx(agent.id, '好孤独啊'));
      const state = engine.getImpulseState(agent.id)!;
      expect(state.activeEvents.find(e => e.name === 'loneliness')).toBeDefined();

      // Fire impulse → dedup should block the message
      setImpulseValue(engine, agent.id, 0.9);
      engine.advanceTime(30);
      await engine.evaluateAll(agent.id);

      // Event was injected into impulseState
      expect(state.activeEvents.length).toBeGreaterThanOrEqual(1);

      // But message was deduped — still only the pre-inserted one
      const pending = engine.getPendingMessages(agent.id);
      expect(pending.filter(m => m.content === '我理解你的感受')).toHaveLength(1);

      vi.restoreAllMocks();
    });

    // --- Test 7: Full session lifecycle — start → chat → fire → deliver → stop → verify persistence ---

    it('full session lifecycle: start → chat → fire → stop → verify persistence', async () => {
      let callCount = 0;
      const card: MetroidCard = {
        ...makeImpulseCard({ fireThreshold: 0.3, cooldownMinutes: 0 }),
        emotion: {
          baseline: { pleasure: 0, arousal: 0, dominance: 0 },
          intensityDial: 0.8,
          expressiveness: 0.8,
          restraint: 0.2,
          moodInertia: 0.5,
          longTermDimensions: ['attachment', 'trust'],
        },
      };
      const agent = identity.createAgent('E2E-7', card, 'enhanced');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      identity.getAgent(agent.id)!.emotionState = { pleasure: 0.5, arousal: 0.3, dominance: 0.1 };
      engine.setGenerateFn(async () => `session msg ${++callCount}`);
      engine.start(agent.id);

      // Multi-turn chat with events
      await engine.onResponse('ok', ctx(agent.id, '你好'));
      await engine.onResponse('ok', ctx(agent.id, '好孤独啊'));
      expect(engine.getImpulseState(agent.id)!.activeEvents.find(e => e.name === 'loneliness')).toBeDefined();

      // Record snapshots for trajectory
      engine.advanceTime(10);
      await engine.evaluateAll(agent.id);
      engine.advanceTime(10);
      await engine.evaluateAll(agent.id);

      // Fire and deliver
      setImpulseValue(engine, agent.id, 0.9);
      await engine.evaluateAll(agent.id);
      const msgs = engine.getPendingMessages(agent.id);
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      engine.markDelivered(msgs[0].id);
      db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-5 minutes') WHERE id = ?`).run(msgs[0].id);

      // User feedback
      await engine.onResponse('谢谢', ctx(agent.id, '谢谢'));
      const reactions = db.prepare('SELECT * FROM proactive_reactions WHERE agent_id = ?').all(agent.id) as any[];
      expect(reactions.length).toBeGreaterThanOrEqual(1);

      // Stop → triggers updateLongTermMood
      engine.stop(agent.id);

      // Verify long_term_mood persisted
      const mood = engine.getLongTermMood(agent.id);
      expect(mood.attachment).toBeDefined();
      expect(mood.trust).toBeDefined();
      expect(typeof mood.attachment).toBe('number');

      // Verify reactions persisted
      const allReactions = db.prepare('SELECT * FROM proactive_reactions WHERE agent_id = ?').all(agent.id) as any[];
      expect(allReactions.length).toBeGreaterThanOrEqual(1);

      // Verify long_term_mood rows in DB
      const moodRows = db.prepare('SELECT * FROM long_term_mood WHERE agent_id = ?').all(agent.id) as any[];
      expect(moodRows.length).toBeGreaterThanOrEqual(1);

      vi.restoreAllMocks();
    });
  });

  // ============================================================
  // V4: Behavioral Dynamics Tests
  // ============================================================

  describe('V4: Behavioral Dynamics', () => {
    let db: Database.Database;
    let identity: IdentityEngine;
    let emotion: EmotionEngine;
    let audit: AuditLog;
    let engine: ProactiveEngine;

    beforeEach(() => {
      db = createTestDb();
      identity = new IdentityEngine(db);
      audit = new AuditLog(db);
      emotion = new EmotionEngine(db, identity, audit, testConfig as any);
      engine = new ProactiveEngine(db, identity, emotion, audit, testConfig as any);
    });

    afterEach(() => {
      engine.stop();
      db.close();
    });

    // --- Feature 1: Cognitive Filter (eventSensitivity) ---

    describe('F1: Cognitive Filter', () => {
      it('should multiply event intensity by sensitivity', () => {
        const card: MetroidCard = {
          ...impulseCard,
          emotion: {
            ...impulseCard.emotion!,
            eventSensitivity: { conflict: 1.5, celebration: 0.5 },
          },
        };
        const agent = identity.createAgent('CF1', card, 'enhanced');
        engine.start(agent.id);

        engine.addActiveEvent(agent.id, 'conflict', 0.6);
        const state = engine.getImpulseState(agent.id)!;
        // 0.6 * 1.5 = 0.9
        expect(state.activeEvents.find(e => e.name === 'conflict')!.intensity).toBeCloseTo(0.9, 1);
      });

      it('should clamp amplified intensity to 1.0', () => {
        const card: MetroidCard = {
          ...impulseCard,
          emotion: {
            ...impulseCard.emotion!,
            eventSensitivity: { conflict: 2.0 },
          },
        };
        const agent = identity.createAgent('CF2', card, 'enhanced');
        engine.start(agent.id);

        engine.addActiveEvent(agent.id, 'conflict', 0.8);
        const state = engine.getImpulseState(agent.id)!;
        // 0.8 * 2.0 = 1.6 → clamped to 1.0
        expect(state.activeEvents[0].intensity).toBe(1.0);
      });

      it('should dampen intensity when sensitivity < 1', () => {
        const card: MetroidCard = {
          ...impulseCard,
          emotion: {
            ...impulseCard.emotion!,
            eventSensitivity: { celebration: 0.3 },
          },
        };
        const agent = identity.createAgent('CF3', card, 'enhanced');
        engine.start(agent.id);

        engine.addActiveEvent(agent.id, 'celebration', 0.8);
        const state = engine.getImpulseState(agent.id)!;
        // 0.8 * 0.3 = 0.24
        expect(state.activeEvents[0].intensity).toBeCloseTo(0.24, 2);
      });

      it('should default to 1.0 for unconfigured events', () => {
        const card: MetroidCard = {
          ...impulseCard,
          emotion: {
            ...impulseCard.emotion!,
            eventSensitivity: { conflict: 2.0 },
          },
        };
        const agent = identity.createAgent('CF4', card, 'enhanced');
        engine.start(agent.id);

        engine.addActiveEvent(agent.id, 'loneliness', 0.5);
        const state = engine.getImpulseState(agent.id)!;
        expect(state.activeEvents[0].intensity).toBe(0.5);
      });

      it('should default to 1.0 when no eventSensitivity configured', () => {
        const agent = identity.createAgent('CF5', impulseCard, 'enhanced');
        engine.start(agent.id);

        engine.addActiveEvent(agent.id, 'conflict', 0.7);
        const state = engine.getImpulseState(agent.id)!;
        expect(state.activeEvents[0].intensity).toBe(0.7);
      });
    });

    // --- Feature 2: Memory Pool Integral + Breach ---

    describe('F2: Memory Pool', () => {
      it('should initialize memoryPressure to 0', () => {
        const agent = identity.createAgent('MP1', impulseCard, 'enhanced');
        engine.start(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        expect(state.memoryPressure).toBe(0);
      });

      it('should accumulate pressure when emotion deviates from baseline', async () => {
        const agent = identity.createAgent('MP2', impulseCard, 'enhanced');
        identity.getAgent(agent.id)!.emotionState = { pleasure: -0.8, arousal: 0.5, dominance: 0 };
        engine.start(agent.id);
        engine.advanceTime(60); // 1 hour
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        expect(state.memoryPressure).toBeGreaterThan(0);
      });

      it('should decay pressure when emotion is at baseline', async () => {
        const agent = identity.createAgent('MP3', impulseCard, 'enhanced');
        identity.getAgent(agent.id)!.emotionState = { pleasure: 0, arousal: 0, dominance: 0 };
        engine.start(agent.id);
        // Manually set pressure
        engine.getImpulseState(agent.id)!.memoryPressure = 0.5;
        engine.advanceTime(60);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        // At baseline, emotionDist=0, so pressure only decays
        expect(state.memoryPressure).toBeLessThan(0.5);
      });

      it('should clamp pressure to [0, 2]', async () => {
        const agent = identity.createAgent('MP4', impulseCard, 'enhanced');
        identity.getAgent(agent.id)!.emotionState = { pleasure: -1, arousal: 1, dominance: -1 };
        engine.start(agent.id);
        engine.getImpulseState(agent.id)!.memoryPressure = 1.9;
        engine.advanceTime(120);
        await engine.evaluateAll(agent.id);
        expect(engine.getImpulseState(agent.id)!.memoryPressure).toBeLessThanOrEqual(2);
      });

      it('should activate memory_breach signal above threshold', async () => {
        const card: MetroidCard = {
          ...proactiveCard,
          name: 'BreachBot',
          emotion: { baseline: { pleasure: 0, arousal: 0, dominance: 0 }, intensityDial: 0.8, expressiveness: 0.8, restraint: 0.2 },
          proactive: {
            enabled: true, triggers: [],
            impulse: {
              enabled: true,
              signals: [{ type: 'memory_breach', weight: 1.0 }],
              decayRate: 0.01, fireThreshold: 0.6, cooldownMinutes: 10,
              promptTemplate: 'breach test',
              memoryBreachThreshold: 0.5,
            },
          },
        };
        const agent = identity.createAgent('MP5', card, 'enhanced');
        engine.start(agent.id);
        // Set pressure above threshold
        engine.getImpulseState(agent.id)!.memoryPressure = 0.8;
        setImpulseValue(engine, agent.id, 0);
        engine.advanceTime(60);
        await engine.evaluateAll(agent.id);
        // breach activation = (0.8 - 0.5) / 0.5 = 0.6
        expect(engine.getImpulseState(agent.id)!.value).toBeGreaterThan(0);
      });

      it('should not activate memory_breach below threshold', async () => {
        const card: MetroidCard = {
          ...proactiveCard,
          name: 'BreachBot2',
          emotion: { baseline: { pleasure: 0, arousal: 0, dominance: 0 }, intensityDial: 0.8, expressiveness: 0.8, restraint: 0.2 },
          proactive: {
            enabled: true, triggers: [],
            impulse: {
              enabled: true,
              signals: [{ type: 'memory_breach', weight: 1.0 }],
              decayRate: 0.01, fireThreshold: 0.6, cooldownMinutes: 10,
              promptTemplate: 'breach test',
              memoryBreachThreshold: 0.7,
            },
          },
        };
        const agent = identity.createAgent('MP6', card, 'enhanced');
        identity.getAgent(agent.id)!.emotionState = { pleasure: 0, arousal: 0, dominance: 0 };
        engine.start(agent.id);
        engine.getImpulseState(agent.id)!.memoryPressure = 0.3;
        setImpulseValue(engine, agent.id, 0);
        engine.advanceTime(60);
        await engine.evaluateAll(agent.id);
        expect(engine.getImpulseState(agent.id)!.value).toBe(0);
      });

      it('should show 情绪积压 in formatInternalState when pressure > 0.1', async () => {
        let capturedPrompt = '';
        const card = makeImpulseCard();
        const agent = identity.createAgent('MP7', card, 'enhanced');
        engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'pressure prompt'; });
        engine.start(agent.id);
        engine.getImpulseState(agent.id)!.memoryPressure = 0.5;
        vi.spyOn(Math, 'random').mockReturnValue(0);
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        expect(capturedPrompt).toContain('情绪积压: 50%');
        vi.restoreAllMocks();
      });
    });

    // --- Feature 3: Self-Action Feedback Loop ---

    describe('F3: Self-Action Feedback', () => {
      it('should set awaitingResponse after impulse fire', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const card = makeImpulseCard();
        const agent = identity.createAgent('SAF1', card, 'enhanced');
        engine.setGenerateFn(async () => 'awaiting test');
        engine.start(agent.id);
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        expect(state.awaitingResponse).toBe(true);
        expect(state.awaitingMessageId).toBeDefined();
        // Should also have awaiting_response event
        expect(state.activeEvents.find(e => e.name === 'awaiting_response')).toBeDefined();
        vi.restoreAllMocks();
      });

      it('should inject response_positive on engaged reply', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const card = makeImpulseCard({ cooldownMinutes: 0 });
        const agent = identity.createAgent('SAF2', card, 'enhanced');
        engine.setGenerateFn(async () => 'feedback test msg');
        engine.start(agent.id);

        // Fire impulse
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        const msgId = state.awaitingMessageId!;
        expect(msgId).toBeDefined();

        // Deliver and set delivered_at
        engine.markDelivered(msgId);
        db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-5 minutes') WHERE id = ?`).run(msgId);

        // User replies → detectReaction fires
        await engine.onResponse('thanks', ctx(agent.id, 'thanks'));

        // Check for response_positive event
        const positiveEvent = state.activeEvents.find(e => e.name === 'response_positive');
        expect(positiveEvent).toBeDefined();
        expect(state.awaitingResponse).toBe(false);
        vi.restoreAllMocks();
      });

      it('should inject message_ignored when stale', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const card = makeImpulseCard({ cooldownMinutes: 0 });
        const agent = identity.createAgent('SAF3', card, 'enhanced');
        engine.setGenerateFn(async () => 'stale test msg');
        engine.start(agent.id);

        // Fire impulse
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        const msgId = state.awaitingMessageId!;

        // Deliver and set delivered_at to 45 min ago (stale)
        engine.markDelivered(msgId);
        db.prepare(`UPDATE proactive_messages SET delivered_at = datetime('now', '-45 minutes') WHERE id = ?`).run(msgId);

        // evaluateAll triggers markStaleAsIgnored
        engine.getImpulseState(agent.id)!.lastFireTime = 0;
        setImpulseValue(engine, agent.id, 0.1);
        await engine.evaluateAll(agent.id);

        const ignoredEvent = state.activeEvents.find(e => e.name === 'message_ignored');
        expect(ignoredEvent).toBeDefined();
        expect(state.awaitingResponse).toBe(false);
        vi.restoreAllMocks();
      });

      it('should initialize awaitingResponse as false', () => {
        const agent = identity.createAgent('SAF4', impulseCard, 'enhanced');
        engine.start(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        expect(state.awaitingResponse).toBe(false);
        expect(state.awaitingMessageId).toBeUndefined();
      });
    });

    // --- Feature 4: Inspiration System ---

    describe('F4: Inspiration System', () => {
      it('should not fire spark when no sparkPool configured', async () => {
        const agent = identity.createAgent('IS1', impulseCard, 'enhanced');
        engine.start(agent.id);
        vi.spyOn(Math, 'random').mockReturnValue(0); // would always pass
        engine.advanceTime(60);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        const inspirations = state.activeEvents.filter(e => e.name.startsWith('inspiration:'));
        expect(inspirations).toHaveLength(0);
        vi.restoreAllMocks();
      });

      it('should fire spark at expected probability', async () => {
        const card: MetroidCard = {
          ...impulseCard,
          proactive: {
            ...impulseCard.proactive!,
            impulse: {
              ...impulseCard.proactive!.impulse!,
              sparkPool: ['月亮', '远方', '咖啡'],
              sparkProbability: 1.0, // always fire
              sparkResonanceThreshold: 0, // always resonate
            },
          },
        };
        const agent = identity.createAgent('IS2', card, 'enhanced');
        engine.start(agent.id);
        // Add an active event for resonance
        engine.addActiveEvent(agent.id, 'loneliness', 0.8);
        vi.spyOn(Math, 'random').mockReturnValue(0); // pass probability + pick first spark
        engine.advanceTime(60);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        const inspirations = state.activeEvents.filter(e => e.name.startsWith('inspiration:'));
        expect(inspirations.length).toBeGreaterThanOrEqual(1);
        vi.restoreAllMocks();
      });

      it('should gate spark by resonance threshold', async () => {
        const card: MetroidCard = {
          ...impulseCard,
          proactive: {
            ...impulseCard.proactive!,
            impulse: {
              ...impulseCard.proactive!.impulse!,
              sparkPool: ['月亮'],
              sparkProbability: 1.0,
              sparkResonanceThreshold: 0.99, // very high threshold
            },
          },
        };
        const agent = identity.createAgent('IS3', card, 'enhanced');
        engine.start(agent.id);
        // No active events, no late-night, no pressure → resonance ≈ 0
        vi.spyOn(Math, 'random').mockReturnValue(0);
        engine.advanceTime(60);
        await engine.evaluateAll(agent.id);
        const state = engine.getImpulseState(agent.id)!;
        const inspirations = state.activeEvents.filter(e => e.name.startsWith('inspiration:'));
        expect(inspirations).toHaveLength(0);
        vi.restoreAllMocks();
      });

      it('should label inspiration events as 灵感 in prompt', async () => {
        let capturedPrompt = '';
        const card: MetroidCard = {
          ...makeImpulseCard(),
          proactive: {
            enabled: true, triggers: [],
            impulse: {
              enabled: true,
              signals: [{ type: 'idle', weight: 0.5, idleMinutes: 30 }],
              decayRate: 0.1, fireThreshold: 0.6, cooldownMinutes: 10,
              promptTemplate: 'spark prompt test',
              sparkPool: ['月亮'],
              sparkProbability: 1.0,
              sparkResonanceThreshold: 0,
            },
          },
        };
        const agent = identity.createAgent('IS4', card, 'enhanced');
        engine.setGenerateFn(async (_id, prompt) => { capturedPrompt = prompt; return 'spark msg'; });
        engine.start(agent.id);
        // Manually inject an inspiration event to test formatting
        engine.addActiveEvent(agent.id, 'inspiration:月亮', 0.6, 0.3, 0.9);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        expect(capturedPrompt).toContain('灵感: 月亮');
        vi.restoreAllMocks();
      });

      it('should be backward compatible when no sparkPool', async () => {
        // Standard impulseCard has no sparkPool — should work identically to before
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const agent = identity.createAgent('IS5', impulseCard, 'enhanced');
        engine.setGenerateFn(async () => 'compat test');
        engine.start(agent.id);
        setImpulseValue(engine, agent.id, 0.9);
        await engine.evaluateAll(agent.id);
        const msgs = engine.getPendingMessages(agent.id);
        expect(msgs.find(m => m.triggerId === 'impulse')).toBeDefined();
        vi.restoreAllMocks();
      });
    });
  });
});