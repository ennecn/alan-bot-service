/**
 * Fast Test -- quick smoke test with N random cards, 1 message each.
 */

import type { CardIndex, TestResult } from './types.js';
import { planTests } from './test-planner.js';
import { runTests } from './test-runner.js';
import type { AlanClientConfig } from './alan-client.js';

export interface FastTestConfig {
  cardIndex: CardIndex;
  alanConfig: AlanClientConfig;
  cardCount?: number;
}

export interface FastTestResult {
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  results: TestResult[];
}

export async function runFastTest(config: FastTestConfig): Promise<FastTestResult> {
  const cardCount = config.cardCount ?? 5;
  const start = Date.now();

  const plan = planTests(config.cardIndex, {
    maxCards: cardCount,
    targetUrl: config.alanConfig.baseUrl,
    parallel: 1,
    prompts: ['Hello!'],
  });

  const results = await runTests(plan, {
    alanConfig: config.alanConfig,
    parallel: 1,
    timeout_ms: 60_000,
  });

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    passed,
    failed,
    total: results.length,
    duration_ms: Date.now() - start,
    results,
  };
}
