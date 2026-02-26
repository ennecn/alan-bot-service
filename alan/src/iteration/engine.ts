/**
 * Iteration Engine — orchestrates the full analyze -> hypothesize -> modify -> test -> evaluate loop.
 */
import type {
  IterationConfig,
  IterationResult,
  IterationSummary,
  AnalysisReport,
} from './types.js';
import { Analyzer } from './analyzer.js';
import type { JudgeVerdictLike } from './analyzer.js';
import { HypothesisGenerator } from './hypothesis.js';
import { Modifier } from './modifier.js';
import { SafetySystem } from './safety.js';
import { Notifier } from './notifier.js';

export class IterationEngine {
  private config: IterationConfig;
  private analyzer: Analyzer;
  private hypothesisGen: HypothesisGenerator;
  private modifier: Modifier;
  private safety: SafetySystem;
  private notifier: Notifier | null;

  constructor(config: IterationConfig) {
    this.config = config;
    this.analyzer = new Analyzer();
    this.hypothesisGen = new HypothesisGenerator({
      llmBaseUrl: config.llmBaseUrl,
      llmModel: config.llmModel,
      apiKey: config.apiKey,
      allowedTiers: config.allowedTiers,
    });
    this.modifier = new Modifier(config.workspacePath);
    this.safety = new SafetySystem({
      workspacePath: config.workspacePath,
      maxRegression: config.maxRegression,
      allowedTiers: config.allowedTiers,
    });
    this.notifier = config.telegram
      ? new Notifier(config.telegram)
      : null;
  }

  /**
   * Run the full iteration loop.
   */
  async run(initialVerdicts: JudgeVerdictLike[]): Promise<IterationSummary> {
    const iterations: IterationResult[] = [];
    let currentVerdicts = initialVerdicts;
    let previousReport: AnalysisReport | undefined;

    // Analyze initial state
    const initialReport = this.analyzer.analyze(currentVerdicts);
    const startScore = initialReport.overallScore;
    let currentScore = startScore;

    let stoppedReason: IterationSummary['stoppedReason'] = 'max_iterations';

    for (let i = 1; i <= this.config.maxIterations; i++) {
      // 1. Analyze current verdicts
      const report = this.analyzer.analyze(currentVerdicts, previousReport);

      // 2. Generate hypothesis
      const hypothesis = await this.hypothesisGen.generate(report, {
        workspacePath: this.config.workspacePath,
        allowedTiers: this.config.allowedTiers,
      });

      // 3. Notify: iteration started
      await this.notifier?.iterationStarted(i, hypothesis);

      // 4. Safety tier 1: validate scope
      const scopeCheck = this.safety.validateScope(hypothesis.modifications);
      if (!scopeCheck.passed) {
        const result: IterationResult = {
          iteration: i,
          hypothesis,
          beforeScore: currentScore,
          afterScore: currentScore,
          improvement: 0,
          safetyChecks: [scopeCheck],
          committed: false,
          reverted: false,
        };
        iterations.push(result);
        await this.notifier?.iterationCompleted(result);
        stoppedReason = 'safety_failure';
        break;
      }

      // 5. Safety tier 2: create branch (skip in dry run)
      let branch: string | undefined;
      if (!this.config.dryRun) {
        const branchCheck = this.safety.createBranch(this.config.workspacePath);
        if (!branchCheck.passed) {
          const result: IterationResult = {
            iteration: i,
            hypothesis,
            beforeScore: currentScore,
            afterScore: currentScore,
            improvement: 0,
            safetyChecks: [scopeCheck, branchCheck],
            committed: false,
            reverted: false,
          };
          iterations.push(result);
          await this.notifier?.iterationCompleted(result);
          stoppedReason = 'safety_failure';
          break;
        }
        branch = branchCheck.details?.branch as string | undefined;
      }

      // 5b. Approval gate for code-tier modifications
      const hasCodeMods = hypothesis.modifications.some(
        (m) => m.tier === 'code',
      );
      if (hasCodeMods) {
        if (!this.config.approvalCallback) {
          console.log(
            `[engine] Skipping code modification: no approval callback configured`,
          );
          const result: IterationResult = {
            iteration: i,
            hypothesis,
            beforeScore: currentScore,
            afterScore: currentScore,
            improvement: 0,
            safetyChecks: [
              scopeCheck,
              {
                passed: false,
                tier: 1,
                message:
                  'Code modification skipped: no approval callback configured',
              },
            ],
            committed: false,
            reverted: false,
            branch,
          };
          iterations.push(result);
          await this.notifier?.iterationCompleted(result);
          continue; // Try next iteration
        }

        // Notify about pending approval
        await this.notifier?.approvalRequired(i, hypothesis);

        // Check approval for each code modification
        let approved = true;
        for (const mod of hypothesis.modifications) {
          if (mod.tier === 'code') {
            const ok = await this.config.approvalCallback(mod);
            if (!ok) {
              approved = false;
              break;
            }
          }
        }

        if (!approved) {
          console.log(
            `[engine] Code modification rejected by approval callback`,
          );
          const result: IterationResult = {
            iteration: i,
            hypothesis,
            beforeScore: currentScore,
            afterScore: currentScore,
            improvement: 0,
            safetyChecks: [
              scopeCheck,
              {
                passed: false,
                tier: 1,
                message: 'Code modification rejected by approval callback',
              },
            ],
            committed: false,
            reverted: false,
            branch,
          };
          iterations.push(result);
          await this.notifier?.iterationCompleted(result);
          continue; // Try next iteration
        }
      }

      // 6. Apply modifications
      if (!this.config.dryRun) {
        this.modifier.applyAll(hypothesis.modifications);
      }

      // 7. Safety tier 3: run fast test (skip in dry run)
      if (!this.config.dryRun) {
        const testCheck = await this.safety.runFastTest(
          this.config.workspacePath,
        );
        if (!testCheck.passed) {
          // Revert modifications and branch
          this.modifier.revertAll(hypothesis.modifications);
          if (branch) {
            this.safety.autoRevert(this.config.workspacePath, branch);
          }
          const result: IterationResult = {
            iteration: i,
            hypothesis,
            beforeScore: currentScore,
            afterScore: currentScore,
            improvement: 0,
            safetyChecks: [scopeCheck, testCheck],
            committed: false,
            reverted: true,
            branch,
          };
          iterations.push(result);
          await this.notifier?.iterationCompleted(result);
          continue; // Try next iteration
        }
      }

      // 8. Evaluate: get new verdicts
      const newVerdicts = await this.evaluateIteration(currentVerdicts);
      const newReport = this.analyzer.analyze(newVerdicts, report);
      const afterScore = newReport.overallScore;
      const improvement = afterScore - currentScore;

      // 9. Safety tier 4: check regression
      const regressionCheck = this.safety.checkRegression(
        currentScore,
        afterScore,
        this.config.maxRegression,
      );

      if (!regressionCheck.passed) {
        // Revert
        if (!this.config.dryRun) {
          this.modifier.revertAll(hypothesis.modifications);
          if (branch) {
            this.safety.autoRevert(this.config.workspacePath, branch);
          }
        }
        const result: IterationResult = {
          iteration: i,
          hypothesis,
          beforeScore: currentScore,
          afterScore,
          improvement,
          safetyChecks: [scopeCheck, regressionCheck],
          committed: false,
          reverted: true,
          branch,
        };
        iterations.push(result);
        await this.notifier?.iterationCompleted(result);
        stoppedReason = 'regression';
        break;
      }

      // 10. Commit iteration
      const result: IterationResult = {
        iteration: i,
        hypothesis,
        beforeScore: currentScore,
        afterScore,
        improvement,
        safetyChecks: [scopeCheck, regressionCheck],
        committed: true,
        reverted: false,
        branch,
      };
      iterations.push(result);

      // Update state for next iteration
      currentScore = afterScore;
      currentVerdicts = newVerdicts;
      previousReport = report;

      // 12. Notify: iteration completed
      await this.notifier?.iterationCompleted(result);

      // 13. Check convergence
      if (Math.abs(improvement) < this.config.convergenceThreshold) {
        stoppedReason = 'converged';
        break;
      }
    }

    const summary: IterationSummary = {
      totalIterations: iterations.length,
      startScore,
      endScore: currentScore,
      totalImprovement: currentScore - startScore,
      iterations,
      converged: stoppedReason === 'converged',
      stoppedReason,
    };

    await this.notifier?.summarize(summary);

    return summary;
  }

  /**
   * Evaluate current state by generating new verdicts.
   * In dry run: simulates a small random improvement.
   * In real mode: placeholder that returns passed verdicts.
   */
  private async evaluateIteration(
    currentVerdicts: JudgeVerdictLike[],
  ): Promise<JudgeVerdictLike[]> {
    if (this.config.dryRun) {
      // Simulate small random improvement
      return currentVerdicts.map((v) => {
        const bump = (Math.random() - 0.3) * 0.2; // slight positive bias
        const newScores = { ...v.scores };
        for (const key of Object.keys(newScores) as Array<
          keyof typeof newScores
        >) {
          newScores[key] = Math.min(
            5,
            Math.max(1, newScores[key] + bump),
          );
        }
        return {
          scores: newScores,
          overall: Math.min(
            5,
            Math.max(1, v.overall + bump),
          ),
          notes: v.notes,
        };
      });
    }

    // Real mode: would run test suite + judge
    // For now, return current verdicts (no change)
    return currentVerdicts;
  }
}
