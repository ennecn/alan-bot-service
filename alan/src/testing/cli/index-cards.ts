#!/usr/bin/env npx tsx
/**
 * CLI: npx tsx src/testing/cli/index-cards.ts [--path <dir>] [--output <file>]
 *
 * Scans a directory for ST character cards and writes a CardIndex JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import { indexCards } from '../card-indexer.js';

function parseArgs(argv: string[]): { path: string; output: string } {
  let scanPath = process.cwd();
  let output = 'test-data/card-index.json';

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--path' && argv[i + 1]) {
      scanPath = argv[++i];
    } else if (argv[i] === '--output' && argv[i + 1]) {
      output = argv[++i];
    }
  }

  return { path: scanPath, output };
}

function main(): void {
  const args = parseArgs(process.argv);
  const resolvedScanPath = path.resolve(args.path);
  const resolvedOutput = path.resolve(args.output);

  console.log(`Scanning: ${resolvedScanPath}`);
  console.log(`Output:   ${resolvedOutput}`);
  console.log('');

  const index = indexCards(resolvedScanPath, {
    onProgress(count, current) {
      process.stdout.write(`\r[${count}] Scanning: ${current}...`);
    },
  });

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  // Print summary
  console.log(`Total cards: ${index.metadata.total}`);
  console.log(`Errors:      ${index.metadata.errors}`);
  console.log('');
  console.log('By language:');
  for (const [lang, count] of Object.entries(index.metadata.by_language)) {
    console.log(`  ${lang}: ${count}`);
  }
  console.log('By format:');
  for (const [fmt, count] of Object.entries(index.metadata.by_format)) {
    console.log(`  ${fmt}: ${count}`);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(resolvedOutput);
  fs.mkdirSync(outputDir, { recursive: true });

  // Write JSON
  fs.writeFileSync(resolvedOutput, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`\nWritten to: ${resolvedOutput}`);
}

main();
