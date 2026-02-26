#!/usr/bin/env npx tsx
/**
 * CLI: npx tsx src/iteration/cli/iterate.ts --workspace <path> [--max-iterations 5] [--dry-run]
 *
 * Usage:
 *   npx tsx src/iteration/cli/iterate.ts --workspace ./alan --verdicts results/verdicts.json --dry-run
 *   npx tsx src/iteration/cli/iterate.ts --workspace ./alan --verdicts results/verdicts.json --llm-url http://localhost:8080
 */
import fs from 'node:fs';
import path from 'node:path';
import { IterationEngine } from '../engine.js';
import type { IterationConfig } from '../types.js';
import type { JudgeVerdictLike } from '../analyzer.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args['workspace']) {
    console.error('Usage: npx tsx src/iteration/cli/iterate.ts --workspace <path> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --workspace <path>       Alan workspace path (required)');
    console.error('  --max-iterations <N>     Max iterations (default 5)');
    console.error('  --dry-run                Simulate without modifying files');
    console.error('  --llm-url <url>          LLM base URL for hypothesis generation');
    console.error('  --llm-model <model>      LLM model name');
    console.error('  --api-key <key>          API key for LLM');
    console.error('  --verdicts <file>        Path to judge verdicts JSON');
    console.error('  --convergence <N>        Convergence threshold (default 0.01)');
    console.error('  --max-regression <N>     Max regression threshold (default 0.05)');
    console.error('  --tiers <list>           Allowed tiers, comma-separated (default: parameter,prompt)');
    process.exit(1);
  }

  const workspacePath = path.resolve(args['workspace']);
  if (!fs.existsSync(workspacePath)) {
    console.error(`Workspace not found: ${workspacePath}`);
    process.exit(1);
  }

  // Load verdicts
  let verdicts: JudgeVerdictLike[] = [];
  if (args['verdicts']) {
    const verdictsPath = path.resolve(args['verdicts']);
    if (!fs.existsSync(verdictsPath)) {
      console.error(`Verdicts file not found: ${verdictsPath}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(verdictsPath, 'utf-8'));
    verdicts = Array.isArray(raw) ? raw : [raw];
  } else {
    console.error('No --verdicts file specified, using empty set');
    verdicts = [];
  }

  // Parse tiers
  const tiersStr = args['tiers'] ?? 'parameter,prompt';
  const allowedTiers = tiersStr.split(',').map((t) => t.trim()) as IterationConfig['allowedTiers'];

  const config: IterationConfig = {
    maxIterations: parseInt(args['max-iterations'] ?? '5', 10),
    convergenceThreshold: parseFloat(args['convergence'] ?? '0.01'),
    maxRegression: parseFloat(args['max-regression'] ?? '0.05'),
    allowedTiers,
    llmBaseUrl: args['llm-url'] ?? 'http://127.0.0.1:8080',
    llmModel: args['llm-model'],
    apiKey: args['api-key'],
    workspacePath,
    dryRun: args['dry-run'] === 'true',
  };

  console.log('=== Alan Auto-Iteration Engine ===');
  console.log(`Workspace: ${config.workspacePath}`);
  console.log(`Max iterations: ${config.maxIterations}`);
  console.log(`Dry run: ${config.dryRun ?? false}`);
  console.log(`Allowed tiers: ${config.allowedTiers.join(', ')}`);
  console.log(`Verdicts loaded: ${verdicts.length}`);
  console.log('');

  const engine = new IterationEngine(config);
  const summary = await engine.run(verdicts);

  console.log('');
  console.log('=== Iteration Summary ===');
  console.log(`Total iterations: ${summary.totalIterations}`);
  console.log(`Score: ${summary.startScore.toFixed(2)} -> ${summary.endScore.toFixed(2)}`);
  console.log(`Improvement: ${summary.totalImprovement >= 0 ? '+' : ''}${summary.totalImprovement.toFixed(3)}`);
  console.log(`Converged: ${summary.converged}`);
  console.log(`Stopped reason: ${summary.stoppedReason}`);

  for (const iter of summary.iterations) {
    const icon = iter.committed ? '[OK]' : '[REVERT]';
    console.log(
      `  ${icon} Iteration ${iter.iteration}: ${iter.beforeScore.toFixed(2)} -> ${iter.afterScore.toFixed(2)} (${iter.hypothesis.description.slice(0, 60)})`,
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
