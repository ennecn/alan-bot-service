#!/usr/bin/env npx tsx
/**
 * CLI: npx tsx src/testing/cli/run-test.ts --plan <plan.json> [--parallel 4] [--report] [--fast]
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TestPlan, CardIndex } from '../types.js';
import { runTests } from '../test-runner.js';
import { runFastTest } from '../fast-test.js';
import { generateReport } from '../report-generator.js';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--report' || arg === '--fast') {
      args[arg.slice(2)] = true;
    } else if (arg.startsWith('--') && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = (args.url as string) ?? 'http://localhost:7088';
  const outputDir = (args.output as string) ?? 'test-reports';
  const parallel = args.parallel ? parseInt(args.parallel as string, 10) : 1;

  if (args.fast) {
    // Fast test mode: load card-index.json from test-data/
    const indexPath = path.resolve('test-data/card-index.json');
    if (!fs.existsSync(indexPath)) {
      console.error(`Card index not found: ${indexPath}`);
      console.error('Run card indexer first: npx tsx src/testing/cli/index-cards.ts ...');
      process.exit(1);
    }

    const cardIndex: CardIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    console.log(`Fast test: ${cardIndex.entries.length} cards in index`);

    const result = await runFastTest({
      cardIndex,
      alanConfig: { baseUrl: url },
      cardCount: 5,
    });

    console.log(`\nResults: ${result.passed}/${result.total} passed (${result.duration_ms}ms)`);
    for (const r of result.results) {
      const status = r.success ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${r.card_name}${r.error ? ` - ${r.error}` : ''}`);
    }

    if (args.report) {
      const reportPath = generateReport(
        {
          results: result.results,
          timestamp: new Date().toISOString(),
          config: { mode: 'fast', url, cardCount: 5 },
        },
        outputDir,
      );
      console.log(`\nReport: ${reportPath}`);
    }

    process.exit(result.failed > 0 ? 1 : 0);
  }

  // Normal mode: load test plan
  const planPath = args.plan as string;
  if (!planPath) {
    console.error('Usage: npx tsx src/testing/cli/run-test.ts --plan <plan.json> [--parallel N] [--report] [--url <url>]');
    console.error('       npx tsx src/testing/cli/run-test.ts --fast [--report] [--url <url>]');
    process.exit(1);
  }

  const plan: TestPlan = JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf-8'));
  console.log(`Running ${plan.cases.length} test cases (parallel: ${parallel})`);

  const results = await runTests(plan, {
    alanConfig: { baseUrl: url },
    parallel,
    timeout_ms: plan.config.timeout_ms,
  });

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nResults: ${passed}/${results.length} passed`);
  for (const r of results) {
    const status = r.success ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${r.card_name}${r.error ? ` - ${r.error}` : ''}`);
  }

  if (args.report) {
    const reportPath = generateReport(
      {
        results,
        timestamp: new Date().toISOString(),
        config: { plan: planPath, parallel, url },
      },
      outputDir,
    );
    console.log(`\nReport: ${reportPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
