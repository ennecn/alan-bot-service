/**
 * Hypothesis Generator — LLM-based improvement suggestion engine.
 */
import type {
  AnalysisReport,
  Hypothesis,
  ModificationTier,
  Modification,
  ScoreDimension,
} from './types.js';

interface HypothesisGeneratorConfig {
  llmBaseUrl: string;
  llmModel?: string;
  apiKey?: string;
  allowedTiers: ModificationTier[];
}

const GENERATE_HYPOTHESIS_TOOL = {
  name: 'generate_hypothesis',
  description:
    'Generate a hypothesis for improving AI character behavior based on test analysis.',
  input_schema: {
    type: 'object' as const,
    properties: {
      target_dimension: {
        type: 'string' as const,
        enum: [
          'character_fidelity',
          'emotional_coherence',
          'creativity',
          'consistency',
          'engagement',
        ],
        description: 'The weakest dimension to target for improvement',
      },
      tier: {
        type: 'string' as const,
        enum: ['parameter', 'prompt', 'code'],
        description: 'Which tier of modification to apply',
      },
      description: {
        type: 'string' as const,
        description: 'Natural language description of the proposed change',
      },
      modifications: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            target_file: {
              type: 'string' as const,
              description: 'Relative file path to modify',
            },
            change_type: {
              type: 'string' as const,
              enum: ['parameter', 'prompt', 'code'],
            },
            details: {
              type: 'object' as const,
              description:
                'Change details: {key, old_value, new_value} for parameter; {section, old_text, new_text} for prompt; {patch, description} for code',
            },
          },
          required: ['target_file', 'change_type', 'details'],
        },
        description: 'Specific modifications to apply',
      },
      expected_improvement: {
        type: 'number' as const,
        description: 'Expected score improvement (0-1 scale)',
      },
      confidence: {
        type: 'number' as const,
        description: 'Confidence in this hypothesis (0-1)',
      },
    },
    required: [
      'target_dimension',
      'tier',
      'description',
      'modifications',
      'expected_improvement',
      'confidence',
    ],
  },
};

export class HypothesisGenerator {
  private config: HypothesisGeneratorConfig;

  constructor(config: HypothesisGeneratorConfig) {
    this.config = config;
  }

  /**
   * Generate a hypothesis for improving scores based on analysis report.
   * Uses LLM with tool_use to produce structured output.
   * Falls back to a simple parameter tweak if LLM fails.
   */
  async generate(
    report: AnalysisReport,
    currentConfig: Record<string, unknown>,
  ): Promise<Hypothesis> {
    try {
      return await this.generateViaLLM(report, currentConfig);
    } catch {
      return this.generateFallback(report);
    }
  }

  private async generateViaLLM(
    report: AnalysisReport,
    currentConfig: Record<string, unknown>,
  ): Promise<Hypothesis> {
    const systemPrompt = this.buildSystemPrompt(report, currentConfig);

    const body = {
      model: this.config.llmModel ?? 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content:
            'Analyze the test results and generate a hypothesis for the most impactful improvement. Focus on the weakest dimension. Use only allowed modification tiers.',
        },
      ],
      tools: [GENERATE_HYPOTHESIS_TOOL],
      tool_choice: { type: 'tool', name: 'generate_hypothesis' },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    const response = await fetch(
      `${this.config.llmBaseUrl}/v1/messages`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: Array<{
        type: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
    };

    // Extract tool_use block
    const toolUse = data.content.find(
      (block) => block.type === 'tool_use' && block.name === 'generate_hypothesis',
    );

    if (!toolUse?.input) {
      throw new Error('No generate_hypothesis tool_use in response');
    }

    return this.parseHypothesis(toolUse.input);
  }

  private buildSystemPrompt(
    report: AnalysisReport,
    currentConfig: Record<string, unknown>,
  ): string {
    return `You are an AI character behavior optimization engine.

## Current Analysis
- Overall score: ${report.overallScore.toFixed(2)}/5
- Sample count: ${report.sampleCount}
- Dimension scores:
${Object.entries(report.dimensionScores)
  .map(([dim, score]) => `  - ${dim}: ${(score as number).toFixed(2)}`)
  .join('\n')}
- Weakest dimensions: ${report.weakestDimensions.slice(0, 3).join(', ')}
- Regressions: ${report.regressions.length > 0 ? report.regressions.join(', ') : 'none'}
- Patterns: ${report.patterns.length > 0 ? report.patterns.join('; ') : 'none identified'}

## Current Config
${JSON.stringify(currentConfig, null, 2)}

## Allowed Modification Tiers
${this.config.allowedTiers.join(', ')}

## Rules
- Only suggest modifications within allowed tiers
- Parameter changes: adjust numeric values, toggle booleans, change string options
- Prompt changes: rewrite sections of system prompts or character instructions
- Code changes: provide unified diff patches (only if 'code' tier is allowed)
- Be specific about file paths and exact changes
- Estimate improvement conservatively`;
  }

  private parseHypothesis(input: Record<string, unknown>): Hypothesis {
    const id = `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetDimension = input.target_dimension as ScoreDimension;
    const tier = input.tier as ModificationTier;

    // Parse modifications and filter to allowed tiers
    const rawMods = (input.modifications ?? []) as Array<{
      target_file: string;
      change_type: string;
      details: Record<string, unknown>;
    }>;

    const modifications: Modification[] = rawMods
      .filter((m) =>
        this.config.allowedTiers.includes(m.change_type as ModificationTier),
      )
      .map((m) => ({
        tier: m.change_type as ModificationTier,
        targetFile: m.target_file,
        change: this.parseChange(m.change_type, m.details),
      }));

    return {
      id,
      targetDimension,
      tier: this.config.allowedTiers.includes(tier)
        ? tier
        : this.config.allowedTiers[0],
      description: (input.description as string) ?? 'LLM-generated hypothesis',
      modifications,
      expectedImprovement: (input.expected_improvement as number) ?? 0.1,
      confidence: Math.min(1, Math.max(0, (input.confidence as number) ?? 0.5)),
    };
  }

  private parseChange(
    changeType: string,
    details: Record<string, unknown>,
  ): Modification['change'] {
    switch (changeType) {
      case 'parameter':
        return {
          type: 'parameter',
          key: (details.key as string) ?? '',
          oldValue: details.old_value,
          newValue: details.new_value,
        };
      case 'prompt':
        return {
          type: 'prompt',
          section: (details.section as string) ?? '',
          oldText: (details.old_text as string) ?? '',
          newText: (details.new_text as string) ?? '',
        };
      case 'code':
        return {
          type: 'code',
          patch: (details.patch as string) ?? '',
          description: (details.description as string) ?? '',
        };
      default:
        return {
          type: 'parameter',
          key: 'unknown',
          oldValue: null,
          newValue: null,
        };
    }
  }

  /**
   * Fallback: generate a simple parameter tweak when LLM is unavailable.
   */
  private generateFallback(report: AnalysisReport): Hypothesis {
    const weakest = report.weakestDimensions[0] ?? 'character_fidelity';
    const id = `hyp-fallback-${Date.now()}`;

    return {
      id,
      targetDimension: weakest,
      tier: 'parameter',
      description: `Fallback: adjust parameters to improve ${weakest.replace(/_/g, ' ')}`,
      modifications: [
        {
          tier: 'parameter',
          targetFile: 'config/alan.json',
          change: {
            type: 'parameter',
            key: weakest,
            oldValue: null,
            newValue: 'optimized',
          },
        },
      ],
      expectedImprovement: 0.05,
      confidence: 0.3,
    };
  }
}
