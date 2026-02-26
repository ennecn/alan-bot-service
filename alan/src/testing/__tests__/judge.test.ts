/**
 * Judge Tests -- covers single judge calls, consensus aggregation,
 * overall score calculation, and fallback on parse errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Judge } from '../judge.js';
import type { JudgeInput } from '../judge.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const DEFAULT_CONFIG = {
  llmBaseUrl: 'http://localhost:8080',
  llmModel: 'test-model',
  apiKey: 'test-key',
  consensusCount: 3,
};

function makeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    characterName: 'TestChar',
    characterDescription: 'A cheerful test character.',
    conversationHistory: [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there! Nice to meet you.' },
    ],
    replyToEvaluate: 'What a wonderful day to go on an adventure!',
    expectedLanguage: 'en',
    ...overrides,
  };
}

function makeJudgeResponse(scores: {
  character_fidelity: number;
  emotional_coherence: number;
  creativity: number;
  consistency: number;
  engagement: number;
  notes: string;
}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'evaluate_reply',
          input: scores,
        },
      ],
    }),
  };
}

describe('Judge', () => {
  let judge: Judge;

  beforeEach(() => {
    judge = new Judge(DEFAULT_CONFIG);
    mockFetch.mockReset();
  });

  // --- Single judge call ---

  describe('single evaluation', () => {
    it('returns scores from LLM', async () => {
      const scores = {
        character_fidelity: 4,
        emotional_coherence: 5,
        creativity: 3,
        consistency: 4,
        engagement: 4,
        notes: 'Good response overall.',
      };

      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput(), 0);

      expect(result.scores.character_fidelity).toBe(4);
      expect(result.scores.emotional_coherence).toBe(5);
      expect(result.scores.creativity).toBe(3);
      expect(result.scores.consistency).toBe(4);
      expect(result.scores.engagement).toBe(4);
      expect(result.card_name).toBe('TestChar');
    });

    it('scores are in range 1-5', async () => {
      const scores = {
        character_fidelity: 4,
        emotional_coherence: 3,
        creativity: 5,
        consistency: 2,
        engagement: 4,
        notes: 'test',
      };

      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput());

      const scoreValues = Object.values(result.scores);
      for (const s of scoreValues) {
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(5);
      }
    });

    it('sends correct request to LLM', async () => {
      const scores = {
        character_fidelity: 3, emotional_coherence: 3, creativity: 3,
        consistency: 3, engagement: 3, notes: 'ok',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      await singleJudge.evaluate(makeInput());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/messages');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('test-model');
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('evaluate_reply');
      expect(body.tool_choice.name).toBe('evaluate_reply');
      expect(options.headers['x-api-key']).toBe('test-key');
    });
  });

  // --- Consensus aggregation ---

  describe('consensus aggregation', () => {
    it('makes 3 parallel calls for default consensusCount', async () => {
      const scores = {
        character_fidelity: 4, emotional_coherence: 4, creativity: 4,
        consistency: 4, engagement: 4, notes: 'good',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      await judge.evaluate(makeInput());

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('uses median of scores across judge calls', async () => {
      // Three different score sets — median should be the middle value
      const scoresSets = [
        { character_fidelity: 3, emotional_coherence: 2, creativity: 4, consistency: 5, engagement: 3, notes: 'low' },
        { character_fidelity: 5, emotional_coherence: 4, creativity: 4, consistency: 3, engagement: 5, notes: 'high' },
        { character_fidelity: 4, emotional_coherence: 3, creativity: 5, consistency: 4, engagement: 4, notes: 'mid' },
      ];

      let callIndex = 0;
      mockFetch.mockImplementation(async () => {
        const scores = scoresSets[callIndex % scoresSets.length];
        callIndex++;
        return makeJudgeResponse(scores);
      });

      const result = await judge.evaluate(makeInput());

      // Median of [3, 5, 4] = 4, [2, 4, 3] = 3, [4, 4, 5] = 4, [5, 3, 4] = 4, [3, 5, 4] = 4
      expect(result.scores.character_fidelity).toBe(4);
      expect(result.scores.emotional_coherence).toBe(3);
      expect(result.scores.creativity).toBe(4);
      expect(result.scores.consistency).toBe(4);
      expect(result.scores.engagement).toBe(4);
    });

    it('concatenates notes from all judge calls', async () => {
      const scoresSets = [
        { character_fidelity: 4, emotional_coherence: 4, creativity: 4, consistency: 4, engagement: 4, notes: 'First note' },
        { character_fidelity: 4, emotional_coherence: 4, creativity: 4, consistency: 4, engagement: 4, notes: 'Second note' },
        { character_fidelity: 4, emotional_coherence: 4, creativity: 4, consistency: 4, engagement: 4, notes: 'Third note' },
      ];

      let callIndex = 0;
      mockFetch.mockImplementation(async () => {
        const scores = scoresSets[callIndex % scoresSets.length];
        callIndex++;
        return makeJudgeResponse(scores);
      });

      const result = await judge.evaluate(makeInput());

      expect(result.notes).toContain('First note');
      expect(result.notes).toContain('Second note');
      expect(result.notes).toContain('Third note');
    });
  });

  // --- Overall score calculation ---

  describe('overall score', () => {
    it('calculates weighted average correctly', async () => {
      // All same score → overall = that score
      const scores = {
        character_fidelity: 4, emotional_coherence: 4, creativity: 4,
        consistency: 4, engagement: 4, notes: 'uniform',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput());

      // 4*0.25 + 4*0.20 + 4*0.20 + 4*0.20 + 4*0.15 = 4.0
      expect(result.overall).toBe(4);
    });

    it('weights character_fidelity highest', async () => {
      // High fidelity, low everything else → overall should be higher than
      // low fidelity, high everything else (due to 0.25 weight)
      const highFidelity = {
        character_fidelity: 5, emotional_coherence: 1, creativity: 1,
        consistency: 1, engagement: 1, notes: 'high fidelity',
      };
      const lowFidelity = {
        character_fidelity: 1, emotional_coherence: 5, creativity: 1,
        consistency: 1, engagement: 1, notes: 'low fidelity',
      };

      mockFetch.mockResolvedValue(makeJudgeResponse(highFidelity));
      const judge1 = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result1 = await judge1.evaluate(makeInput());

      mockFetch.mockResolvedValue(makeJudgeResponse(lowFidelity));
      const judge2 = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result2 = await judge2.evaluate(makeInput());

      // high fidelity: 5*0.25 + 1*0.20 + 1*0.20 + 1*0.20 + 1*0.15 = 2.0
      // low fidelity:  1*0.25 + 5*0.20 + 1*0.20 + 1*0.20 + 1*0.15 = 1.8
      expect(result1.overall).toBeGreaterThan(result2.overall);
    });

    it('overall is between 1 and 5', async () => {
      const scores = {
        character_fidelity: 2, emotional_coherence: 5, creativity: 1,
        consistency: 3, engagement: 4, notes: 'mixed',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput());

      expect(result.overall).toBeGreaterThanOrEqual(1);
      expect(result.overall).toBeLessThanOrEqual(5);
    });
  });

  // --- Fallback on error ---

  describe('fallback behavior', () => {
    it('returns default scores (all 3s) on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await judge.evaluate(makeInput());

      expect(result.scores.character_fidelity).toBe(3);
      expect(result.scores.emotional_coherence).toBe(3);
      expect(result.scores.creativity).toBe(3);
      expect(result.scores.consistency).toBe(3);
      expect(result.scores.engagement).toBe(3);
      expect(result.notes).toContain('Error');
    });

    it('returns default scores on non-OK response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await judge.evaluate(makeInput());

      expect(result.scores.character_fidelity).toBe(3);
      expect(result.overall).toBe(3);
    });

    it('returns default scores when LLM returns no tool_use block', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'no tool' }] }),
      });

      const result = await judge.evaluate(makeInput());

      expect(result.scores.character_fidelity).toBe(3);
    });

    it('clamps out-of-range scores', async () => {
      const scores = {
        character_fidelity: 10, emotional_coherence: -1, creativity: 0,
        consistency: 6, engagement: 100, notes: 'crazy scores',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput());

      expect(result.scores.character_fidelity).toBe(5);
      expect(result.scores.emotional_coherence).toBe(1);
      expect(result.scores.creativity).toBe(1);
      expect(result.scores.consistency).toBe(5);
      expect(result.scores.engagement).toBe(5);
    });

    it('handles mixed success and failure in consensus', async () => {
      // 2 succeed, 1 fails → still get a result
      let callIndex = 0;
      mockFetch.mockImplementation(async () => {
        callIndex++;
        if (callIndex === 2) throw new Error('One call failed');
        return makeJudgeResponse({
          character_fidelity: 4, emotional_coherence: 4, creativity: 4,
          consistency: 4, engagement: 4, notes: 'success',
        });
      });

      const result = await judge.evaluate(makeInput());

      // Median of [4, 3, 4] = 4 for fidelity (failed call returns 3)
      expect(result.scores.character_fidelity).toBe(4);
    });
  });

  // --- case_index pass-through ---

  describe('case_index', () => {
    it('uses provided caseIndex', async () => {
      const scores = {
        character_fidelity: 4, emotional_coherence: 4, creativity: 4,
        consistency: 4, engagement: 4, notes: 'test',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput(), 7);

      expect(result.case_index).toBe(7);
    });

    it('defaults case_index to 0', async () => {
      const scores = {
        character_fidelity: 4, emotional_coherence: 4, creativity: 4,
        consistency: 4, engagement: 4, notes: 'test',
      };
      mockFetch.mockResolvedValue(makeJudgeResponse(scores));

      const singleJudge = new Judge({ ...DEFAULT_CONFIG, consensusCount: 1 });
      const result = await singleJudge.evaluate(makeInput());

      expect(result.case_index).toBe(0);
    });
  });
});
