/**
 * Test Runner -- executes test plans against Alan Engine or ST.
 */

import type { TestPlan, TestResult } from './types.js';
import { sendMessage as sendAlanMessage } from './alan-client.js';
import type { AlanClientConfig } from './alan-client.js';

/**
 * Parse a time jump instruction from a Director message.
 * Returns the number of hours to jump, or null if not a time jump.
 */
export function parseTimeJump(message: string): number | null {
  const match = message.match(/^\[TIME_JUMP:\s*(\d+)\s*hours?\]$/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

export interface RunnerConfig {
  alanConfig: AlanClientConfig;
  parallel?: number;
  timeout_ms?: number;
}

async function runInBatches<T>(
  tasks: (() => Promise<T>)[],
  batchSize: number,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((t) => t()));
    results.push(...batchResults);
  }
  return results;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function runSingleCase(
  testCase: { card_path: string; card_name: string; prompts: string[] },
  caseIndex: number,
  config: RunnerConfig,
): Promise<TestResult> {
  const timeout = config.timeout_ms ?? 60_000;

  try {
    const replies: TestResult['replies'] = [];
    let currentTimestamp = Date.now();

    // Read card file to use as system prompt
    for (const prompt of testCase.prompts) {
      // Check if this prompt is a time jump instruction
      const jumpHours = parseTimeJump(prompt);
      if (jumpHours !== null) {
        // Advance internal timestamp; don't send to Alan/ST
        currentTimestamp += jumpHours * 3600_000;
        replies.push({
          prompt,
          reply: `[TIME_ADVANCED: ${jumpHours} hours, now ${new Date(currentTimestamp).toISOString()}]`,
          latency_ms: 0,
          tokens: { input: 0, output: 0 },
        });
        continue;
      }

      const response = await withTimeout(
        sendAlanMessage(prompt, config.alanConfig, undefined),
        timeout,
      );
      replies.push({
        prompt,
        reply: response.text,
        latency_ms: response.latency_ms,
        tokens: response.tokens,
      });
    }

    return {
      case_index: caseIndex,
      card_name: testCase.card_name,
      card_path: testCase.card_path,
      replies,
      success: true,
    };
  } catch (err) {
    return {
      case_index: caseIndex,
      card_name: testCase.card_name,
      card_path: testCase.card_path,
      replies: [],
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runTests(
  plan: TestPlan,
  config: RunnerConfig,
): Promise<TestResult[]> {
  const parallel = config.parallel ?? plan.config.parallel ?? 1;

  const tasks = plan.cases.map((testCase, i) => () => runSingleCase(testCase, i, config));

  return runInBatches(tasks, parallel);
}
