/**
 * Testing framework types -- shared across card indexer, test runner, director, judge.
 */

export interface CardIndexEntry {
  /** Absolute path to the card file */
  path: string;
  /** Character name extracted from card */
  name: string;
  /** File format: 'png' or 'json' */
  format: 'png' | 'json';
  /** File size in bytes */
  size: number;
  /** Whether the card contains NSFW markers */
  nsfw: boolean;
  /** Detected language of the card content */
  detected_language: string;
  /** Estimated token count for the card's total content */
  token_estimate: number;
  /** Tags from the card metadata */
  tags: string[];
  /** Whether the card has a lorebook/character_book */
  has_lorebook: boolean;
  /** Number of WI entries in the lorebook */
  wi_count: number;
}

export interface CardIndex {
  /** All indexed card entries */
  entries: CardIndexEntry[];
  /** Scan metadata */
  metadata: {
    scan_date: string;
    scan_path: string;
    total: number;
    by_language: Record<string, number>;
    by_format: Record<string, number>;
    errors: number;
  };
}

export interface TimeJumpInstruction {
  type: 'time_jump';
  hours: number;
  narrative?: string;
}

// --- Test Runner Types (used by Stream 2) ---

export interface TestCase {
  card_path: string;
  card_name: string;
  prompts: string[];
  expected_language: string;
  expected_tone?: string;
}

export interface TestPlan {
  cases: TestCase[];
  config: {
    parallel: number;
    timeout_ms: number;
    target_url: string;
  };
}

export interface TestResult {
  case_index: number;
  card_name: string;
  card_path: string;
  replies: Array<{
    prompt: string;
    reply: string;
    latency_ms: number;
    tokens: { input: number; output: number };
  }>;
  success: boolean;
  error?: string;
}

export interface JudgeVerdict {
  case_index: number;
  card_name: string;
  scores: {
    character_fidelity: number;  // 1-5
    emotional_coherence: number; // 1-5
    creativity: number;          // 1-5
    consistency: number;         // 1-5
    engagement: number;          // 1-5
  };
  overall: number;              // weighted average
  notes: string;
}
