/**
 * Analyzer — identifies weaknesses and patterns from test results.
 */
import type { AnalysisReport, ScoreDimension } from './types.js';

const ALL_DIMENSIONS: ScoreDimension[] = [
  'character_fidelity',
  'emotional_coherence',
  'creativity',
  'consistency',
  'engagement',
];

export interface JudgeVerdictLike {
  scores: Record<ScoreDimension, number>;
  overall: number;
  notes: string;
}

export class Analyzer {
  /**
   * Analyze verdicts to produce a report with dimension averages,
   * weakest dimensions, recurring patterns, and regressions.
   */
  analyze(
    verdicts: JudgeVerdictLike[],
    previousReport?: AnalysisReport,
  ): AnalysisReport {
    if (verdicts.length === 0) {
      return {
        overallScore: 0,
        dimensionScores: Object.fromEntries(
          ALL_DIMENSIONS.map((d) => [d, 0]),
        ) as Record<ScoreDimension, number>,
        weakestDimensions: [...ALL_DIMENSIONS],
        patterns: [],
        regressions: [],
        sampleCount: 0,
      };
    }

    // Calculate per-dimension averages
    const dimensionSums: Record<ScoreDimension, number> = Object.fromEntries(
      ALL_DIMENSIONS.map((d) => [d, 0]),
    ) as Record<ScoreDimension, number>;

    for (const verdict of verdicts) {
      for (const dim of ALL_DIMENSIONS) {
        dimensionSums[dim] += verdict.scores[dim] ?? 0;
      }
    }

    const dimensionScores: Record<ScoreDimension, number> = Object.fromEntries(
      ALL_DIMENSIONS.map((d) => [d, dimensionSums[d] / verdicts.length]),
    ) as Record<ScoreDimension, number>;

    // Overall average
    const overallScore =
      verdicts.reduce((sum, v) => sum + v.overall, 0) / verdicts.length;

    // Sort dimensions ascending to find weakest
    const weakestDimensions = [...ALL_DIMENSIONS].sort(
      (a, b) => dimensionScores[a] - dimensionScores[b],
    );

    // Extract patterns from notes
    const notes = verdicts.map((v) => v.notes).filter(Boolean);
    const patterns = this.extractPatterns(notes);

    // Find regressions compared to previous report
    const regressions = this.findRegressions(
      dimensionScores,
      previousReport?.dimensionScores,
    );

    return {
      overallScore,
      dimensionScores,
      weakestDimensions,
      patterns,
      regressions,
      sampleCount: verdicts.length,
    };
  }

  /**
   * Extract recurring patterns from judge notes using keyword frequency.
   * Returns top-5 most frequent multi-word phrases (2-3 word n-grams).
   */
  private extractPatterns(notes: string[]): string[] {
    const phraseCounts = new Map<string, number>();

    for (const note of notes) {
      // Normalize: lowercase, remove punctuation except hyphens
      const cleaned = note
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const words = cleaned.split(' ').filter((w) => w.length > 2);

      // Count 2-gram and 3-gram phrases
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const phrase = words.slice(i, i + n).join(' ');
          phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
        }
      }
    }

    // Filter phrases that appear more than once, sort by count descending
    return [...phraseCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase]) => phrase);
  }

  /**
   * Find dimensions that regressed (dropped) compared to a previous report.
   */
  private findRegressions(
    current: Record<ScoreDimension, number>,
    previous?: Record<ScoreDimension, number>,
  ): ScoreDimension[] {
    if (!previous) return [];

    return ALL_DIMENSIONS.filter((dim) => current[dim] < previous[dim]);
  }
}
