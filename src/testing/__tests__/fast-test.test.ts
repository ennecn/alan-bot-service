/**
 * Fast Test Tests -- covers card selection, pass/fail counting, duration tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CardIndex } from '../types.js';

vi.mock('../alan-client.js', () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from '../alan-client.js';
import { runFastTest } from '../fast-test.js';

const mockSendMessage = vi.mocked(sendMessage);

function makeCardIndex(count: number): CardIndex {
  return {
    entries: Array.from({ length: count }, (_, i) => ({
      path: `/cards/card${i}.json`,
      name: `TestCard${i}`,
      format: 'json' as const,
      size: 1000,
      nsfw: false,
      detected_language: 'en',
      token_estimate: 500,
      tags: [],
      has_lorebook: false,
      wi_count: 0,
    })),
    metadata: {
      scan_date: '2026-01-01T00:00:00Z',
      scan_path: '/cards',
      total: count,
      by_language: { en: count },
      by_format: { json: count },
      errors: 0,
    },
  };
}

beforeEach(() => {
  mockSendMessage.mockReset();
});

describe('runFastTest', () => {
  it('selects the correct number of cards (default 5)', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'Hello!',
      latency_ms: 50,
      tokens: { input: 5, output: 3 },
    });

    const result = await runFastTest({
      cardIndex: makeCardIndex(20),
      alanConfig: { baseUrl: 'http://localhost:7088' },
    });

    expect(result.total).toBe(5);
    expect(mockSendMessage).toHaveBeenCalledTimes(5);
  });

  it('selects custom card count', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'ok',
      latency_ms: 10,
      tokens: { input: 5, output: 2 },
    });

    const result = await runFastTest({
      cardIndex: makeCardIndex(10),
      alanConfig: { baseUrl: 'http://localhost:7088' },
      cardCount: 3,
    });

    expect(result.total).toBe(3);
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
  });

  it('uses all cards when fewer than cardCount', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'ok',
      latency_ms: 10,
      tokens: { input: 5, output: 2 },
    });

    const result = await runFastTest({
      cardIndex: makeCardIndex(2),
      alanConfig: { baseUrl: 'http://localhost:7088' },
      cardCount: 5,
    });

    expect(result.total).toBe(2);
  });

  it('counts passed and failed correctly', async () => {
    let callCount = 0;
    mockSendMessage.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error('API error');
      return { text: 'ok', latency_ms: 10, tokens: { input: 5, output: 2 } };
    });

    const result = await runFastTest({
      cardIndex: makeCardIndex(3),
      alanConfig: { baseUrl: 'http://localhost:7088' },
      cardCount: 3,
    });

    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('tracks total duration', async () => {
    mockSendMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { text: 'ok', latency_ms: 20, tokens: { input: 5, output: 2 } };
    });

    const result = await runFastTest({
      cardIndex: makeCardIndex(2),
      alanConfig: { baseUrl: 'http://localhost:7088' },
      cardCount: 2,
    });

    expect(result.duration_ms).toBeGreaterThanOrEqual(20);
  });

  it('sends "Hello!" as the single prompt', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'Hi there!',
      latency_ms: 50,
      tokens: { input: 5, output: 4 },
    });

    await runFastTest({
      cardIndex: makeCardIndex(1),
      alanConfig: { baseUrl: 'http://localhost:7088' },
      cardCount: 1,
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      'Hello!',
      { baseUrl: 'http://localhost:7088' },
      undefined,
    );
  });

  it('returns individual results', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'Response',
      latency_ms: 30,
      tokens: { input: 5, output: 3 },
    });

    const result = await runFastTest({
      cardIndex: makeCardIndex(2),
      alanConfig: { baseUrl: 'http://localhost:7088' },
      cardCount: 2,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].replies[0].reply).toBe('Response');
  });
});
