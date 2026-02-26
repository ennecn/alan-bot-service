/**
 * Test Runner Tests -- covers request sending, timeout handling, batch execution, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestPlan } from '../types.js';

vi.mock('../alan-client.js', () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from '../alan-client.js';
import { runTests } from '../test-runner.js';

const mockSendMessage = vi.mocked(sendMessage);

const makePlan = (caseCount: number, promptsPerCase: number = 1): TestPlan => ({
  cases: Array.from({ length: caseCount }, (_, i) => ({
    card_path: `/cards/card${i}.json`,
    card_name: `Card${i}`,
    prompts: Array.from({ length: promptsPerCase }, (_, j) => `Prompt ${j}`),
    expected_language: 'en',
  })),
  config: {
    parallel: 1,
    timeout_ms: 60_000,
    target_url: 'http://localhost:7088',
  },
});

beforeEach(() => {
  mockSendMessage.mockReset();
});

describe('runTests', () => {
  it('sends correct requests to Alan client for each prompt', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'Hello!',
      latency_ms: 100,
      tokens: { input: 10, output: 5 },
    });

    const plan = makePlan(1, 2);
    const results = await runTests(plan, {
      alanConfig: { baseUrl: 'http://localhost:7088' },
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].replies).toHaveLength(2);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledWith(
      'Prompt 0',
      { baseUrl: 'http://localhost:7088' },
      undefined,
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      'Prompt 1',
      { baseUrl: 'http://localhost:7088' },
      undefined,
    );
  });

  it('marks case as failed on error', async () => {
    mockSendMessage.mockRejectedValue(new Error('Connection refused'));

    const plan = makePlan(1);
    const results = await runTests(plan, {
      alanConfig: { baseUrl: 'http://localhost:7088' },
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Connection refused');
    expect(results[0].replies).toHaveLength(0);
  });

  it('handles timeout', async () => {
    mockSendMessage.mockImplementation(
      () => new Promise((_resolve) => setTimeout(() => {}, 5000)),
    );

    const plan = makePlan(1);
    const results = await runTests(plan, {
      alanConfig: { baseUrl: 'http://localhost:7088' },
      timeout_ms: 50,
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Timeout');
  });

  it('executes cases in batches when parallel > 1', async () => {
    const callOrder: number[] = [];
    mockSendMessage.mockImplementation(async () => {
      const idx = callOrder.length;
      callOrder.push(idx);
      // Small delay to observe batching
      await new Promise((r) => setTimeout(r, 10));
      return { text: 'ok', latency_ms: 10, tokens: { input: 5, output: 2 } };
    });

    const plan = makePlan(4);
    const results = await runTests(plan, {
      alanConfig: { baseUrl: 'http://localhost:7088' },
      parallel: 2,
    });

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('collects reply data correctly', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'Reply text',
      latency_ms: 250,
      tokens: { input: 15, output: 8 },
    });

    const plan = makePlan(1, 1);
    const results = await runTests(plan, {
      alanConfig: { baseUrl: 'http://localhost:7088' },
    });

    const reply = results[0].replies[0];
    expect(reply.prompt).toBe('Prompt 0');
    expect(reply.reply).toBe('Reply text');
    expect(reply.latency_ms).toBe(250);
    expect(reply.tokens).toEqual({ input: 15, output: 8 });
  });

  it('preserves case_index and card metadata', async () => {
    mockSendMessage.mockResolvedValue({
      text: 'ok',
      latency_ms: 10,
      tokens: { input: 5, output: 2 },
    });

    const plan = makePlan(3);
    const results = await runTests(plan, {
      alanConfig: { baseUrl: 'http://localhost:7088' },
    });

    expect(results[0].case_index).toBe(0);
    expect(results[0].card_name).toBe('Card0');
    expect(results[1].case_index).toBe(1);
    expect(results[2].case_index).toBe(2);
    expect(results[2].card_path).toBe('/cards/card2.json');
  });
});
