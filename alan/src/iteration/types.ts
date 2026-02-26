/**
 * Auto-Iteration Engine — Type Definitions
 */

export type ModificationTier = 'parameter' | 'prompt' | 'code';

export type ScoreDimension =
  | 'character_fidelity'
  | 'emotional_coherence'
  | 'creativity'
  | 'consistency'
  | 'engagement';

export interface IterationConfig {
  /** Max iteration loops (default 5) */
  maxIterations: number;
  /** Convergence threshold — stop if improvement < this (default 0.01 = 1%) */
  convergenceThreshold: number;
  /** Maximum allowed regression per dimension (default 0.05 = 5%) */
  maxRegression: number;
  /** Allowed modification tiers (default: ['parameter', 'prompt']) */
  allowedTiers: ModificationTier[];
  /** LLM config for hypothesis generation */
  llmBaseUrl: string;
  llmModel?: string;
  apiKey?: string;
  /** Workspace path for the Alan Engine */
  workspacePath: string;
  /** Telegram notification config */
  telegram?: {
    botToken: string;
    chatId: string;
  };
  /** Dry run mode — don't actually modify files */
  dryRun?: boolean;
  /** Approval callback for code-tier modifications. If absent, code modifications are skipped. */
  approvalCallback?: (modification: Modification) => Promise<boolean>;
}

export interface AnalysisReport {
  /** Overall average score */
  overallScore: number;
  /** Per-dimension averages */
  dimensionScores: Record<ScoreDimension, number>;
  /** Weakest dimensions (sorted ascending) */
  weakestDimensions: ScoreDimension[];
  /** Recurring patterns identified */
  patterns: string[];
  /** Regression areas (dimensions that dropped from previous iteration) */
  regressions: ScoreDimension[];
  /** Sample count */
  sampleCount: number;
}

export interface Hypothesis {
  id: string;
  /** What to improve */
  targetDimension: ScoreDimension;
  /** Which tier of modification */
  tier: ModificationTier;
  /** Natural language description */
  description: string;
  /** Specific modifications to apply */
  modifications: Modification[];
  /** Expected improvement */
  expectedImprovement: number;
  /** Confidence 0-1 */
  confidence: number;
}

export interface Modification {
  tier: ModificationTier;
  /** Target file path (relative to workspace) */
  targetFile: string;
  /** What to change — depends on tier */
  change: ParameterChange | PromptChange | CodeChange;
}

export interface ParameterChange {
  type: 'parameter';
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface PromptChange {
  type: 'prompt';
  section: string;
  oldText: string;
  newText: string;
}

export interface CodeChange {
  type: 'code';
  patch: string; // unified diff format
  description: string;
}

export interface SafetyCheck {
  passed: boolean;
  tier: number; // 1-5
  message: string;
  details?: Record<string, unknown>;
}

export interface IterationResult {
  iteration: number;
  hypothesis: Hypothesis;
  beforeScore: number;
  afterScore: number;
  improvement: number;
  safetyChecks: SafetyCheck[];
  committed: boolean;
  reverted: boolean;
  branch?: string;
}

export interface IterationSummary {
  totalIterations: number;
  startScore: number;
  endScore: number;
  totalImprovement: number;
  iterations: IterationResult[];
  converged: boolean;
  stoppedReason: 'converged' | 'max_iterations' | 'regression' | 'safety_failure';
}
