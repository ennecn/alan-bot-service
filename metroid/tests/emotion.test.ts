import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createTestAgent } from './helpers.js';
import { IdentityEngine } from '../src/engines/identity/index.js';
import { EmotionEngine } from '../src/engines/emotion/index.js';
import { AuditLog } from '../src/security/audit.js';
import type { EngineContext, MetroidMessage, AgentMode, MetroidCard } from '../src/types.js';
import type Database from 'better-sqlite3';

const testConfig = {
  dataDir: ':memory:', dbPath: ':memory:',
  memory: { encodingSampleRate: 0.3, importanceThreshold: 0.4, fadeThreshold: 0.3, maxRetrievalResults: 5, defaultTimeWindowHours: 72 },
  llm: { apiKey: 'test', mainModel: 'test', lightModel: 'test', maxContextTokens: 200_000 },
  compiler: { responseReserveRatio: 0.3 },
  emotion: { minChangeInterval: 30_000, maxChangePerUpdate: 0.3, recoveryRate: 0.05 },
  growth: { evaluationInterval: 10, minConfidence: 0.5, maxActiveChanges: 20 },
};

function makeMsg(content: string): MetroidMessage {
  return { id: `msg-${Date.now()}`, content, author: { id: 'u1', name: 'User', isBot: false }, timestamp: new Date() } as any;
}

function ctx(agentId: string, mode: AgentMode, msg: string, history: string[] = []): EngineContext {
  return {
    agentId, mode,
    message: makeMsg(msg),
    conversationHistory: history.map(h => makeMsg(h)),
  };
}

const testCard: MetroidCard = {
  name: 'TestBot', description: 'A test bot', personality: 'friendly',
  emotion: { baseline: { pleasure: 0, arousal: 0, dominance: 0 }, intensityDial: 0.5 },
  growth: { enabled: false, maxDrift: 0.3, logChanges: true },
  soul: { immutableValues: [], mutableTraits: [] },
};

describe('EmotionEngine', () => {
  let db: Database.Database;
  let identity: IdentityEngine;
  let audit: AuditLog;
  let engine: EmotionEngine;
  let agentId: string;

  beforeEach(() => {
    db = createTestDb();
    audit = new AuditLog(db);
    identity = new IdentityEngine(db);
    const agent = identity.createAgent('TestBot', testCard, 'enhanced');
    agentId = agent.id;
    engine = new EmotionEngine(db, identity, audit, testConfig);
  });

  // === analyzeEmotion ===

  describe('analyzeEmotion', () => {
    it('should detect positive sentiment from praise words', () => {
      const delta = engine.analyzeEmotion('You are amazing and wonderful!', []);
      expect(delta.pleasure).toBeGreaterThan(0);
    });

    it('should detect negative sentiment from frustration markers', () => {
      const delta = engine.analyzeEmotion('This is terrible and frustrating', []);
      expect(delta.pleasure).toBeLessThan(0);
    });

    it('should detect high arousal from exclamation marks', () => {
      const delta = engine.analyzeEmotion('WOW!!! This is incredible!!!', []);
      expect(delta.arousal).toBeGreaterThan(0);
    });

    it('should detect dominance-up from command words', () => {
      const delta = engine.analyzeEmotion('Tell me now, I need this immediately', []);
      expect(delta.dominance).toBeGreaterThan(0);
    });

    it('should detect dominance-down from uncertain language', () => {
      const delta = engine.analyzeEmotion('Maybe, I think, not sure, sorry', []);
      expect(delta.dominance).toBeLessThan(0);
    });

    it('should return near-zero delta for neutral messages', () => {
      const delta = engine.analyzeEmotion('The weather is 20 degrees today.', []);
      expect(Math.abs(delta.pleasure)).toBeLessThan(0.1);
      expect(Math.abs(delta.arousal)).toBeLessThan(0.1);
      expect(Math.abs(delta.dominance)).toBeLessThan(0.1);
    });

    it('should consider conversation history', () => {
      const delta = engine.analyzeEmotion('ok', [{ content: 'I love this so much, amazing!' }]);
      expect(delta.pleasure).toBeGreaterThan(0);
    });

    it('should handle Chinese positive words', () => {
      const delta = engine.analyzeEmotion('哈哈太好了，你好厉害！', []);
      expect(delta.pleasure).toBeGreaterThan(0);
    });

    it('should handle Chinese negative words', () => {
      const delta = engine.analyzeEmotion('烦死了，真是糟糕', []);
      expect(delta.pleasure).toBeLessThan(0);
    });
  });

  // === applyDelta ===

  describe('applyDelta', () => {
    it('should clamp delta to maxChangePerUpdate', () => {
      const current = { pleasure: 0, arousal: 0, dominance: 0 };
      const delta = { pleasure: 1.0, arousal: 1.0, dominance: 1.0 };
      const result = engine.applyDelta(current, delta, 1.0);
      expect(result.pleasure).toBeLessThanOrEqual(0.3);
      expect(result.arousal).toBeLessThanOrEqual(0.3);
    });

    it('should apply intensityDial as multiplier', () => {
      const current = { pleasure: 0, arousal: 0, dominance: 0 };
      const delta = { pleasure: 0.2, arousal: 0, dominance: 0 };
      const full = engine.applyDelta(current, delta, 1.0);
      const half = engine.applyDelta(current, delta, 0.5);
      expect(half.pleasure).toBeCloseTo(full.pleasure / 2, 2);
    });

    it('should clamp final values to [-1, 1]', () => {
      const current = { pleasure: 0.9, arousal: -0.9, dominance: 0 };
      const delta = { pleasure: 0.5, arousal: -0.5, dominance: 0 };
      const result = engine.applyDelta(current, delta, 1.0);
      expect(result.pleasure).toBeLessThanOrEqual(1.0);
      expect(result.arousal).toBeGreaterThanOrEqual(-1.0);
    });
  });

  // === applyRecovery ===

  describe('applyRecovery', () => {
    it('should drift toward baseline over time', () => {
      const current = { pleasure: 0.5, arousal: 0.5, dominance: 0.5 };
      const baseline = { pleasure: 0, arousal: 0, dominance: 0 };
      const result = engine.applyRecovery(current, baseline, 2); // 2 hours
      expect(result.pleasure).toBeLessThan(0.5);
      expect(result.pleasure).toBeGreaterThan(0);
    });

    it('should not overshoot baseline', () => {
      const current = { pleasure: 0.03, arousal: 0, dominance: 0 };
      const baseline = { pleasure: 0, arousal: 0, dominance: 0 };
      const result = engine.applyRecovery(current, baseline, 100); // long time
      expect(result.pleasure).toBe(0);
    });

    it('should return current state when no time elapsed', () => {
      const current = { pleasure: 0.5, arousal: 0.3, dominance: -0.2 };
      const baseline = { pleasure: 0, arousal: 0, dominance: 0 };
      const result = engine.applyRecovery(current, baseline, 0);
      expect(result).toEqual(current);
    });
  });

  // === getPromptFragments ===

  describe('getPromptFragments', () => {
    it('should return empty in classic mode', async () => {
      const fragments = await engine.getPromptFragments(ctx(agentId, 'classic', 'hello'));
      expect(fragments).toHaveLength(0);
    });

    it('should return style hints in enhanced mode when emotion deviates', async () => {
      // First set a non-neutral emotion state
      const agent = identity.getAgent(agentId)!;
      agent.emotionState = { pleasure: 0.5, arousal: 0.5, dominance: 0.3 };

      const fragments = await engine.getPromptFragments(ctx(agentId, 'enhanced', 'hello'));
      expect(fragments.length).toBeGreaterThan(0);
      expect(fragments[0].content).toContain('<emotion_context>');
      expect(fragments[0].source).toBe('emotion');
      expect(fragments[0].priority).toBe(40);
    });

    it('should return empty when emotion is near baseline', async () => {
      // Agent starts at baseline (0,0,0)
      const fragments = await engine.getPromptFragments(ctx(agentId, 'enhanced', 'hello'));
      expect(fragments).toHaveLength(0);
    });
  });

  // === onResponse ===

  describe('onResponse', () => {
    it('should update emotion state after positive message', async () => {
      // Use a config with 0 interval for testing
      const fastConfig = { ...testConfig, emotion: { ...testConfig.emotion, minChangeInterval: 0 } };
      const fastEngine = new EmotionEngine(db, identity, audit, fastConfig);

      await fastEngine.onResponse('ok', ctx(agentId, 'enhanced', 'I love this, amazing!'));
      const agent = identity.getAgent(agentId)!;
      expect(agent.emotionState.pleasure).toBeGreaterThan(0);
    });

    it('should skip in classic mode', async () => {
      const fastConfig = { ...testConfig, emotion: { ...testConfig.emotion, minChangeInterval: 0 } };
      const fastEngine = new EmotionEngine(db, identity, audit, fastConfig);

      await fastEngine.onResponse('ok', ctx(agentId, 'classic', 'I love this!'));
      const agent = identity.getAgent(agentId)!;
      expect(agent.emotionState.pleasure).toBe(0);
    });

    it('should persist state to database', async () => {
      const fastConfig = { ...testConfig, emotion: { ...testConfig.emotion, minChangeInterval: 0 } };
      const fastEngine = new EmotionEngine(db, identity, audit, fastConfig);

      await fastEngine.onResponse('ok', ctx(agentId, 'enhanced', 'Amazing wonderful great!'));
      const row = db.prepare('SELECT emotion_state FROM agents WHERE id = ?').get(agentId) as any;
      const state = JSON.parse(row.emotion_state);
      expect(state.pleasure).toBeGreaterThan(0);
    });
  });

  // === translateToStyleHints ===

  describe('translateToStyleHints', () => {
    it('should map high P + high A to lively style', () => {
      const hints = engine.translateToStyleHints({ pleasure: 0.5, arousal: 0.5, dominance: 0 }, 0.5);
      expect(hints).toContain('正面');
      expect(hints).toContain('高');
    });

    it('should map low P + low A to subdued style', () => {
      const hints = engine.translateToStyleHints({ pleasure: -0.5, arousal: -0.5, dominance: 0 }, 0.5);
      expect(hints).toContain('负面');
      expect(hints).toContain('低');
    });

    it('should map high D to confident style', () => {
      const hints = engine.translateToStyleHints({ pleasure: 0, arousal: 0, dominance: 0.5 }, 0.5);
      expect(hints).toContain('强');
    });

    it('should return empty for near-zero state', () => {
      const hints = engine.translateToStyleHints({ pleasure: 0.05, arousal: 0.05, dominance: 0.05 }, 0.5);
      expect(hints).toBe('');
    });

    it('should raise threshold for low expressiveness', () => {
      // With expressiveness=0.3, threshold = 0.15 + 0.7*0.35 = 0.395
      // So pleasure=0.3 should NOT produce hints
      const hints = engine.translateToStyleHints({ pleasure: 0.3, arousal: 0, dominance: 0 }, 0.5, 0.3);
      expect(hints).toBe('');
    });

    it('should add restraint hint for low expressiveness', () => {
      // With expressiveness=0.3, threshold=0.395, pleasure=0.5 passes
      const hints = engine.translateToStyleHints({ pleasure: 0.5, arousal: 0, dominance: 0 }, 0.5, 0.3);
      expect(hints).toContain('内敛');
    });
  });
});
