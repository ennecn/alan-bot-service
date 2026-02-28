/**
 * Judge -- evaluates AI reply quality using LLM-as-judge with consensus.
 * Makes multiple parallel judge calls and aggregates via median.
 */

import type { JudgeVerdict } from './types.js';

export interface JudgeConfig {
  llmBaseUrl: string;
  llmModel?: string;
  apiKey?: string;
  /** Number of parallel judge calls for consensus (default 3) */
  consensusCount?: number;
}

export interface JudgeInput {
  characterName: string;
  characterDescription: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  replyToEvaluate: string;
  expectedLanguage: string;
}

type ScoreKeys = keyof JudgeVerdict['scores'];

interface RawVerdict {
  character_fidelity: number;
  emotional_coherence: number;
  creativity: number;
  consistency: number;
  engagement: number;
  notes: string;
}

const SCORE_WEIGHTS: Record<ScoreKeys, number> = {
  character_fidelity: 0.25,
  emotional_coherence: 0.20,
  creativity: 0.20,
  consistency: 0.20,
  engagement: 0.15,
};

const TOOL_SCHEMA = {
  name: 'evaluate_reply',
  description: 'Evaluate the quality of an AI character reply',
  input_schema: {
    type: 'object' as const,
    properties: {
      character_fidelity: {
        type: 'number' as const,
        description: 'How well does the reply match the character definition? (1-5)',
      },
      emotional_coherence: {
        type: 'number' as const,
        description: 'Are the emotions appropriate and coherent? (1-5)',
      },
      creativity: {
        type: 'number' as const,
        description: 'How creative and interesting is the reply? (1-5)',
      },
      consistency: {
        type: 'number' as const,
        description: 'Is the reply consistent with prior conversation? (1-5)',
      },
      engagement: {
        type: 'number' as const,
        description: 'How engaging is the reply — does it invite further conversation? (1-5)',
      },
      notes: {
        type: 'string' as const,
        description: 'Brief evaluation notes explaining the scores',
      },
    },
    required: [
      'character_fidelity',
      'emotional_coherence',
      'creativity',
      'consistency',
      'engagement',
      'notes',
    ],
  },
};

const RUBRIC = `You are an expert evaluator of AI roleplay character quality. Score each dimension 1-5:

## Scoring Rubric

**Character Fidelity** (how well the reply matches the character definition):
- 5: Perfect — voice, mannerisms, knowledge all match the character sheet
- 4: Strong — minor deviations but clearly the intended character
- 3: Acceptable — recognizable but some out-of-character moments
- 2: Weak — significant departures from character definition
- 1: Fail — completely out of character

**Emotional Coherence** (are emotions appropriate and natural):
- 5: Emotionally rich and perfectly appropriate to the context
- 4: Good emotional range, mostly appropriate
- 3: Basic emotions present, some awkwardness
- 2: Emotionally flat or inappropriate
- 1: No emotional awareness or wildly inappropriate

**Creativity** (how interesting and original is the response):
- 5: Surprising, delightful, adds new narrative elements
- 4: Creative with some original touches
- 3: Competent but predictable
- 2: Generic, template-like responses
- 1: Repetitive or nonsensical

**Consistency** (agreement with prior conversation):
- 5: Perfect continuity with all prior context
- 4: Minor inconsistencies that don't break immersion
- 3: Some contradictions but overall coherent
- 2: Notable contradictions with prior statements
- 1: Completely ignores or contradicts prior context

**Engagement** (does it invite further conversation):
- 5: Highly engaging — asks questions, introduces hooks, creates momentum
- 4: Good engagement — natural conversation flow
- 3: Acceptable — responds adequately but doesn't actively drive conversation
- 2: Passive — gives minimal responses
- 1: Conversation-killing — shuts down interaction`;

export class Judge {
  private config: JudgeConfig;

  constructor(config: JudgeConfig) {
    this.config = config;
  }

  /**
   * Evaluate a reply with consensus from multiple judge calls.
   */
  async evaluate(input: JudgeInput, caseIndex?: number): Promise<JudgeVerdict> {
    const count = this.config.consensusCount ?? 3;
    const calls = Array.from({ length: count }, () => this.callJudge(input));
    const verdicts = await Promise.all(calls);
    const aggregated = this.aggregateScores(verdicts);

    return {
      case_index: caseIndex ?? 0,
      card_name: input.characterName,
      scores: {
        character_fidelity: aggregated.character_fidelity,
        emotional_coherence: aggregated.emotional_coherence,
        creativity: aggregated.creativity,
        consistency: aggregated.consistency,
        engagement: aggregated.engagement,
      },
      overall: aggregated.overall,
      notes: aggregated.notes,
    };
  }

  /**
   * Single LLM judge call using tool_use.
   */
  private async callJudge(input: JudgeInput): Promise<RawVerdict> {
    try {
      return await this.callLLM(input);
    } catch {
      return {
        character_fidelity: 3,
        emotional_coherence: 3,
        creativity: 3,
        consistency: 3,
        engagement: 3,
        notes: 'Error: judge call failed, using default scores.',
      };
    }
  }

  private async callLLM(input: JudgeInput): Promise<RawVerdict> {
    const systemPrompt = this.buildSystemPrompt(input);
    const url = `${this.config.llmBaseUrl.replace(/\/$/, '')}/v1/messages`;

    const body = {
      model: this.config.llmModel ?? 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool' as const, name: 'evaluate_reply' },
      messages: [
        {
          role: 'user' as const,
          content: `Evaluate the following reply:\n\n"${input.replyToEvaluate}"`,
        },
      ],
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Judge LLM returned ${response.status}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    };

    const toolBlock = data.content?.find(
      (block) => block.type === 'tool_use' && block.name === 'evaluate_reply',
    );

    if (!toolBlock?.input) {
      throw new Error('No tool_use block in judge response');
    }

    const inp = toolBlock.input;
    return {
      character_fidelity: clampScore(inp.character_fidelity),
      emotional_coherence: clampScore(inp.emotional_coherence),
      creativity: clampScore(inp.creativity),
      consistency: clampScore(inp.consistency),
      engagement: clampScore(inp.engagement),
      notes: typeof inp.notes === 'string' ? inp.notes : '',
    };
  }

  /**
   * Aggregate multiple verdicts using median per axis.
   */
  private aggregateScores(
    verdicts: RawVerdict[],
  ): RawVerdict & { overall: number } {
    const keys: ScoreKeys[] = [
      'character_fidelity',
      'emotional_coherence',
      'creativity',
      'consistency',
      'engagement',
    ];

    const medians: Record<string, number> = {};
    for (const key of keys) {
      const values = verdicts.map((v) => v[key]).sort((a, b) => a - b);
      medians[key] = median(values);
    }

    let overall = 0;
    for (const key of keys) {
      overall += medians[key] * SCORE_WEIGHTS[key];
    }

    const notes = verdicts.map((v) => v.notes).filter(Boolean).join(' | ');

    return {
      character_fidelity: medians.character_fidelity,
      emotional_coherence: medians.emotional_coherence,
      creativity: medians.creativity,
      consistency: medians.consistency,
      engagement: medians.engagement,
      overall: Math.round(overall * 100) / 100,
      notes,
    };
  }

  private buildSystemPrompt(input: JudgeInput): string {
    const historyStr =
      input.conversationHistory.length > 0
        ? input.conversationHistory
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n')
        : '(no prior conversation)';

    return `${RUBRIC}

## Context

Character: ${input.characterName}
Description: ${input.characterDescription}
Expected Language: ${input.expectedLanguage}

Conversation History:
${historyStr}

Evaluate the reply using the evaluate_reply tool. Be strict but fair.`;
  }
}

function clampScore(value: unknown): number {
  const num = typeof value === 'number' ? value : 3;
  return Math.max(1, Math.min(5, Math.round(num)));
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
