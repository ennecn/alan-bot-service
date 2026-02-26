/**
 * 5-Tier Safety System for auto-iteration.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import type { Modification, SafetyCheck, IterationConfig } from './types.js';

/** Files that must never be modified by auto-iteration */
const CRITICAL_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'node_modules',
  '.git',
  '.env',
]);

type SafetyConfig = Pick<
  IterationConfig,
  'workspacePath' | 'maxRegression' | 'allowedTiers'
>;

export class SafetySystem {
  private config: SafetyConfig;

  constructor(config: SafetyConfig) {
    this.config = config;
  }

  /**
   * Tier 1: Validate that all modifications are within allowed scope.
   */
  validateScope(modifications: Modification[]): SafetyCheck {
    for (const mod of modifications) {
      // Check tier is allowed
      if (!this.config.allowedTiers.includes(mod.tier)) {
        return {
          passed: false,
          tier: 1,
          message: `Modification tier "${mod.tier}" is not allowed. Allowed: ${this.config.allowedTiers.join(', ')}`,
        };
      }

      // Check target file is within workspace
      const resolved = path.resolve(this.config.workspacePath, mod.targetFile);
      const wsResolved = path.resolve(this.config.workspacePath);
      if (!resolved.startsWith(wsResolved)) {
        return {
          passed: false,
          tier: 1,
          message: `Target file "${mod.targetFile}" resolves outside workspace`,
        };
      }

      // Check not a critical file
      const basename = path.basename(mod.targetFile);
      const topLevel = mod.targetFile.split(/[/\\]/)[0];
      if (CRITICAL_FILES.has(basename) || CRITICAL_FILES.has(topLevel)) {
        return {
          passed: false,
          tier: 1,
          message: `Cannot modify critical file: ${mod.targetFile}`,
        };
      }
    }

    return {
      passed: true,
      tier: 1,
      message: `Scope validation passed for ${modifications.length} modification(s)`,
    };
  }

  /**
   * Tier 2: Create a git branch for the iteration.
   */
  createBranch(workspace: string): SafetyCheck {
    const branchName = `alan-iter-${Date.now()}`;
    try {
      execSync(`git checkout -b ${branchName}`, {
        cwd: workspace,
        stdio: 'pipe',
      });
      return {
        passed: true,
        tier: 2,
        message: `Created branch ${branchName}`,
        details: { branch: branchName },
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown git error';
      return {
        passed: false,
        tier: 2,
        message: `Failed to create branch: ${message}`,
      };
    }
  }

  /**
   * Tier 3: Run fast tests in the workspace.
   */
  async runFastTest(workspace: string): Promise<SafetyCheck> {
    try {
      execSync('npx vitest run', {
        cwd: workspace,
        stdio: 'pipe',
        timeout: 120_000,
      });
      return {
        passed: true,
        tier: 3,
        message: 'All tests passed',
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown test error';
      return {
        passed: false,
        tier: 3,
        message: `Tests failed: ${message}`,
      };
    }
  }

  /**
   * Tier 4: Check for score regression.
   */
  checkRegression(
    beforeScore: number,
    afterScore: number,
    maxRegression: number,
  ): SafetyCheck {
    const drop = beforeScore - afterScore;

    if (drop > maxRegression) {
      return {
        passed: false,
        tier: 4,
        message: `Score regressed by ${drop.toFixed(3)} (max allowed: ${maxRegression})`,
        details: { beforeScore, afterScore, drop, maxRegression },
      };
    }

    return {
      passed: true,
      tier: 4,
      message: `Regression check passed (drop: ${drop.toFixed(3)}, max: ${maxRegression})`,
      details: { beforeScore, afterScore, drop, maxRegression },
    };
  }

  /**
   * Tier 5: Auto-revert to main branch and delete the iteration branch.
   */
  autoRevert(workspace: string, branch: string): SafetyCheck {
    try {
      execSync('git checkout main', { cwd: workspace, stdio: 'pipe' });
      execSync(`git branch -D ${branch}`, {
        cwd: workspace,
        stdio: 'pipe',
      });
      return {
        passed: true,
        tier: 5,
        message: `Reverted to main, deleted branch ${branch}`,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown git error';
      return {
        passed: false,
        tier: 5,
        message: `Auto-revert failed: ${message}`,
      };
    }
  }

  /**
   * Run safety tiers 1-4 sequentially. Stops on first failure.
   */
  async runAll(
    modifications: Modification[],
    beforeScore: number,
    afterScore: number,
  ): Promise<SafetyCheck[]> {
    const results: SafetyCheck[] = [];

    // Tier 1: validate scope
    const scopeCheck = this.validateScope(modifications);
    results.push(scopeCheck);
    if (!scopeCheck.passed) return results;

    // Tier 2: create branch
    const branchCheck = this.createBranch(this.config.workspacePath);
    results.push(branchCheck);
    if (!branchCheck.passed) return results;

    // Tier 3: run tests
    const testCheck = await this.runFastTest(this.config.workspacePath);
    results.push(testCheck);
    if (!testCheck.passed) return results;

    // Tier 4: check regression
    const regressionCheck = this.checkRegression(
      beforeScore,
      afterScore,
      this.config.maxRegression,
    );
    results.push(regressionCheck);

    return results;
  }
}
