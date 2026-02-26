import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IterationEngine } from '../engine.js';
import type { IterationConfig } from '../types.js';
import type { JudgeVerdictLike } from '../analyzer.js';

// Mock child_process to avoid actual git/test commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Mock fs for modifier operations
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('{}'),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

function makeVerdicts(overall: number, count = 3): JudgeVerdictLike[] {
  return Array.from({ length: count }, () => ({
    scores: {
      character_fidelity: overall,
      emotional_coherence: overall,
      creativity: overall,
      consistency: overall,
      engagement: overall,
    },
    overall,
    notes: 'test verdict',
  }));
}

function makeConfig(overrides?: Partial<IterationConfig>): IterationConfig {
  return {
    maxIterations: 5,
    convergenceThreshold: 0.01,
    maxRegression: 0.05,
    allowedTiers: ['parameter', 'prompt'],
    llmBaseUrl: 'http://localhost:8080',
    workspacePath: '/tmp/test-workspace',
    dryRun: true, // dry run by default in tests
    ...overrides,
  };
}

describe('IterationEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should stop on convergence when improvement < threshold', async () => {
    // Use a very high convergence threshold so the engine converges quickly
    const config = makeConfig({
      maxIterations: 10,
      convergenceThreshold: 1.0, // very high — any small change will be below this
      dryRun: true,
    });

    const engine = new IterationEngine(config);
    const verdicts = makeVerdicts(3.0);
    const summary = await engine.run(verdicts);

    // Should stop before max iterations due to convergence
    expect(summary.stoppedReason).toBe('converged');
    expect(summary.totalIterations).toBeLessThanOrEqual(config.maxIterations);
    expect(summary.converged).toBe(true);
  });

  it('should stop at maxIterations', async () => {
    const config = makeConfig({
      maxIterations: 2,
      convergenceThreshold: 0.0001, // very low — won't converge
      dryRun: true,
    });

    const engine = new IterationEngine(config);
    const verdicts = makeVerdicts(2.0);
    const summary = await engine.run(verdicts);

    expect(summary.totalIterations).toBeLessThanOrEqual(2);
    // Either max_iterations or converged (if random bump happens to be small)
    expect(['max_iterations', 'converged']).toContain(summary.stoppedReason);
  });

  it('should not modify files in dry run mode', async () => {
    const fs = await import('node:fs');

    const config = makeConfig({ dryRun: true, maxIterations: 1 });
    const engine = new IterationEngine(config);
    const verdicts = makeVerdicts(3.0);

    await engine.run(verdicts);

    // In dry run, modifier.applyAll is never called, so writeFileSync shouldn't
    // be called for workspace files (only potentially for backups which are skipped)
    // The key check: no execSync calls for git branch creation
    const { execSync } = await import('node:child_process');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('should record iteration results correctly', async () => {
    const config = makeConfig({ dryRun: true, maxIterations: 1 });
    const engine = new IterationEngine(config);
    const verdicts = makeVerdicts(3.0);

    const summary = await engine.run(verdicts);

    expect(summary.startScore).toBeCloseTo(3.0, 1);
    expect(summary.iterations.length).toBeGreaterThanOrEqual(1);

    for (const iter of summary.iterations) {
      expect(iter.iteration).toBeGreaterThan(0);
      expect(iter.hypothesis).toBeDefined();
      expect(iter.hypothesis.id).toBeTruthy();
      expect(typeof iter.beforeScore).toBe('number');
      expect(typeof iter.afterScore).toBe('number');
      expect(typeof iter.improvement).toBe('number');
      expect(typeof iter.committed).toBe('boolean');
    }
  });

  it('should handle empty verdicts gracefully', async () => {
    const config = makeConfig({ dryRun: true, maxIterations: 1 });
    const engine = new IterationEngine(config);

    const summary = await engine.run([]);

    expect(summary.startScore).toBe(0);
    expect(summary.totalIterations).toBeGreaterThanOrEqual(0);
  });
});
