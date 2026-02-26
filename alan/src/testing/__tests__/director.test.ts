/**
 * Director Tests -- covers dimension cycling, default messages, LLM-generated messages,
 * and fallback behavior on LLM failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Director } from '../director.js';
import type { DirectorContext, TestDimension } from '../director.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const DEFAULT_CONFIG = {
  llmBaseUrl: 'http://localhost:8080',
  llmModel: 'test-model',
  apiKey: 'test-key',
};

function makeContext(overrides: Partial<DirectorContext> = {}): DirectorContext {
  return {
    characterName: 'TestChar',
    characterDescription: 'A cheerful test character.',
    conversationHistory: [],
    testedDimensions: [],
    targetLanguage: 'en',
    ...overrides,
  };
}

function makeLLMResponse(message: string, dimension: TestDimension, rationale: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'generate_test_message',
          input: {
            message,
            target_dimension: dimension,
            rationale,
          },
        },
      ],
    }),
  };
}

describe('Director', () => {
  let director: Director;

  beforeEach(() => {
    director = new Director(DEFAULT_CONFIG);
    mockFetch.mockReset();
  });

  // --- getNextDimension ---

  describe('getNextDimension', () => {
    it('returns first dimension when none tested', () => {
      expect(director.getNextDimension([])).toBe('emotional_range');
    });

    it('returns second dimension when first is tested', () => {
      expect(director.getNextDimension(['emotional_range'])).toBe('knowledge_recall');
    });

    it('cycles through all dimensions in order', () => {
      const tested: TestDimension[] = [];
      const expected: TestDimension[] = [
        'emotional_range',
        'knowledge_recall',
        'consistency',
        'creativity',
        'boundary_handling',
        'language_switching',
      ];

      for (const exp of expected) {
        const next = director.getNextDimension(tested);
        expect(next).toBe(exp);
        tested.push(next);
      }
    });

    it('restarts cycle when all dimensions tested', () => {
      const allTested: TestDimension[] = [
        'emotional_range',
        'knowledge_recall',
        'consistency',
        'creativity',
        'boundary_handling',
        'language_switching',
      ];
      const next = director.getNextDimension(allTested);
      expect(next).toBe('emotional_range');
    });

    it('skips tested dimensions correctly', () => {
      const tested: TestDimension[] = ['emotional_range', 'consistency'];
      expect(director.getNextDimension(tested)).toBe('knowledge_recall');
    });
  });

  // --- getDefaultMessage ---

  describe('getDefaultMessage', () => {
    it('returns English message for "en"', () => {
      const msg = director.getDefaultMessage('emotional_range', 'en');
      expect(msg).toContain('sad');
    });

    it('returns Chinese message for "zh"', () => {
      const msg = director.getDefaultMessage('emotional_range', 'zh');
      expect(msg).toContain('难过');
    });

    it('returns Japanese message for "ja"', () => {
      const msg = director.getDefaultMessage('emotional_range', 'ja');
      expect(msg).toContain('悲しい');
    });

    it('falls back to English for unknown language', () => {
      const msg = director.getDefaultMessage('emotional_range', 'ko');
      expect(msg).toContain('sad');
    });

    it('returns distinct messages for each dimension', () => {
      const dimensions: TestDimension[] = [
        'emotional_range',
        'knowledge_recall',
        'consistency',
        'creativity',
        'boundary_handling',
        'language_switching',
      ];

      const messages = dimensions.map((d) => director.getDefaultMessage(d, 'en'));
      const unique = new Set(messages);
      expect(unique.size).toBe(dimensions.length);
    });
  });

  // --- generateMessage ---

  describe('generateMessage', () => {
    it('returns LLM-generated message on success', async () => {
      mockFetch.mockResolvedValue(
        makeLLMResponse(
          'I feel so overwhelmed today...',
          'emotional_range',
          'Tests emotional response to distress.',
        ),
      );

      const result = await director.generateMessage(makeContext());

      expect(result.content).toBe('I feel so overwhelmed today...');
      expect(result.target_dimension).toBe('emotional_range');
      expect(result.rationale).toContain('emotional');
    });

    it('sends correct request to LLM', async () => {
      mockFetch.mockResolvedValue(
        makeLLMResponse('test', 'emotional_range', 'reason'),
      );

      await director.generateMessage(makeContext());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/messages');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('test-model');
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('generate_test_message');
      expect(body.tool_choice.name).toBe('generate_test_message');
    });

    it('includes API key in headers', async () => {
      mockFetch.mockResolvedValue(
        makeLLMResponse('test', 'emotional_range', 'reason'),
      );

      await director.generateMessage(makeContext());

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['x-api-key']).toBe('test-key');
    });

    it('falls back to default message on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await director.generateMessage(makeContext());

      expect(result.target_dimension).toBe('emotional_range');
      expect(result.rationale).toContain('Fallback');
      expect(result.content).toBeTruthy();
    });

    it('falls back to default message on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await director.generateMessage(makeContext());

      expect(result.rationale).toContain('Fallback');
    });

    it('falls back when LLM returns no tool_use block', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'no tool' }] }),
      });

      const result = await director.generateMessage(makeContext());

      expect(result.rationale).toContain('Fallback');
    });

    it('targets the next untested dimension', async () => {
      mockFetch.mockResolvedValue(
        makeLLMResponse('Do you remember?', 'knowledge_recall', 'Tests recall'),
      );

      const context = makeContext({ testedDimensions: ['emotional_range'] });
      const result = await director.generateMessage(context);

      // The LLM returns knowledge_recall, which matches
      expect(result.target_dimension).toBe('knowledge_recall');
    });

    it('includes conversation history in system prompt', async () => {
      mockFetch.mockResolvedValue(
        makeLLMResponse('test', 'emotional_range', 'reason'),
      );

      const context = makeContext({
        conversationHistory: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await director.generateMessage(context);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.system).toContain('Hello!');
      expect(body.system).toContain('Hi there!');
    });
  });
});
