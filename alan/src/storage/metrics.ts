/**
 * MetricsWriter — append CoordinatorMetrics as JSONL to workspace internal/ directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CoordinatorMetrics } from '../types/actions.js';

export class MetricsWriter {
  private internalDir: string;

  constructor(workspacePath: string) {
    this.internalDir = path.join(workspacePath, 'internal');
    fs.mkdirSync(this.internalDir, { recursive: true });
  }

  write(metrics: CoordinatorMetrics): void {
    const date = metrics.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(this.internalDir, `metrics-${date}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(metrics) + '\n');
  }

  getRecent(n: number): CoordinatorMetrics[] {
    const files = this.listMetricsFiles();
    const results: CoordinatorMetrics[] = [];

    // Read files newest-first until we have enough
    for (let i = files.length - 1; i >= 0 && results.length < n; i--) {
      const content = fs.readFileSync(files[i], 'utf-8').trim();
      if (!content) continue;
      const lines = content.split('\n');
      for (let j = lines.length - 1; j >= 0 && results.length < n; j--) {
        try {
          results.push(JSON.parse(lines[j]) as CoordinatorMetrics);
        } catch {
          // skip malformed lines
        }
      }
    }
    return results;
  }

  cleanup(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const filePath of this.listMetricsFiles()) {
      const match = path.basename(filePath).match(/^metrics-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (match && match[1] < cutoffStr) {
        fs.unlinkSync(filePath);
      }
    }
  }

  private listMetricsFiles(): string[] {
    if (!fs.existsSync(this.internalDir)) return [];
    return fs
      .readdirSync(this.internalDir)
      .filter((f) => f.startsWith('metrics-') && f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(this.internalDir, f));
  }
}
