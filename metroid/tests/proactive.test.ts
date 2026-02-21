import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    beforeEach(() => {
      const agent = identity.createAgent('ProBot', proactiveCard, 'enhanced');
      agentId = agent.id;
      engine.setGenerateFn(async (_id, _prompt) => '你好呀，好久不见！');
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
      expect(msgs[0].content).toBe('你好呀，好久不见！');
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

    it('should deduplicate events by name', () => {
      engine.start(agentId);
      engine.addActiveEvent(agentId, 'loneliness', 0.5);
      engine.addActiveEvent(agentId, 'loneliness', 0.8);
      const state = engine.getImpulseState(agentId);
      expect(state!.activeEvents).toHaveLength(1);
      expect(state!.activeEvents[0].intensity).toBe(0.8); // takes max
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
});
