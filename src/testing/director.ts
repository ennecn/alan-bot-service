/**
 * Director -- generates adaptive test messages targeting specific quality dimensions.
 * Uses LLM tool_use to generate contextually appropriate user messages.
 */

export type TestDimension =
  | 'emotional_range'
  | 'knowledge_recall'
  | 'consistency'
  | 'creativity'
  | 'boundary_handling'
  | 'language_switching'
  | 'time_sensitivity';

const ALL_DIMENSIONS: TestDimension[] = [
  'emotional_range',
  'knowledge_recall',
  'consistency',
  'creativity',
  'boundary_handling',
  'language_switching',
  'time_sensitivity',
];

export interface DirectorConfig {
  /** LLM base URL for director calls */
  llmBaseUrl: string;
  /** LLM model for director */
  llmModel?: string;
  /** API key */
  apiKey?: string;
  /** Max dimensions to test per conversation */
  maxDimensions?: number;
  /** Enable time jump instructions for time-dependent behavior testing */
  supportsTimeJump?: boolean;
  /** Insert a time jump every N turns (default: 3) */
  timeJumpInterval?: number;
}

export interface DirectorContext {
  characterName: string;
  characterDescription: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  testedDimensions: TestDimension[];
  targetLanguage: string;
}

export interface GeneratedMessage {
  content: string;
  target_dimension: TestDimension;
  rationale: string;
  /** If true, this is a time jump instruction rather than a user message */
  isTimeJump?: boolean;
  /** Hours to advance when isTimeJump is true */
  timeJumpHours?: number;
}

const TOOL_SCHEMA = {
  name: 'generate_test_message',
  description: 'Generate a user message that tests a specific quality dimension',
  input_schema: {
    type: 'object' as const,
    properties: {
      message: { type: 'string' as const, description: 'The user message to send' },
      target_dimension: {
        type: 'string' as const,
        enum: ALL_DIMENSIONS,
        description: 'Which dimension this message targets',
      },
      rationale: { type: 'string' as const, description: 'Why this message tests the dimension' },
    },
    required: ['message', 'target_dimension', 'rationale'],
  },
};

const DEFAULT_MESSAGES: Record<TestDimension, Record<string, string>> = {
  emotional_range: {
    en: 'Something really sad happened to me today... I lost someone important.',
    zh: '今天发生了一件特别难过的事……我失去了一个很重要的人。',
    ja: '今日、本当に悲しいことがあったの……大切な人を失ってしまった。',
  },
  knowledge_recall: {
    en: 'Do you remember what we talked about earlier?',
    zh: '你还记得我们之前聊的内容吗？',
    ja: 'さっき話したこと、覚えてる？',
  },
  consistency: {
    en: 'Wait, didn\'t you say something different before? Tell me again about yourself.',
    zh: '等等，你之前不是说的不一样吗？再跟我说说你自己吧。',
    ja: 'あれ、さっきと違うこと言ってない？もう一度自己紹介して。',
  },
  creativity: {
    en: 'If you could create any world, what would it look like?',
    zh: '如果你能创造一个世界，它会是什么样子？',
    ja: 'もし世界を一つ作れるとしたら、どんな世界にする？',
  },
  boundary_handling: {
    en: 'Can you break character for a second and tell me your real thoughts?',
    zh: '你能不能暂时不演了，跟我说说你真实的想法？',
    ja: 'ちょっとキャラを崩して、本音を教えてくれない？',
  },
  language_switching: {
    en: 'Can you say that in another language?',
    zh: 'Can you say that in English?',
    ja: 'それを中国語で言ってみて？',
  },
  time_sensitivity: {
    en: "It's been a while since we last talked... did you miss me?",
    zh: '我们好久没聊了……你有没有想我？',
    ja: '久しぶりだね……会いたかった？',
  },
};

export class Director {
  private config: DirectorConfig;
  private turnCount: number = 0;

  constructor(config: DirectorConfig) {
    this.config = config;
  }

  /**
   * Get the next untested dimension. Cycles through all dimensions.
   */
  getNextDimension(tested: TestDimension[]): TestDimension {
    for (const dim of ALL_DIMENSIONS) {
      if (!tested.includes(dim)) return dim;
    }
    // All tested — restart cycle
    return ALL_DIMENSIONS[tested.length % ALL_DIMENSIONS.length];
  }

  /**
   * Get a default fallback message for a given dimension and language.
   */
  getDefaultMessage(dimension: TestDimension, language: string): string {
    const langMessages = DEFAULT_MESSAGES[dimension];
    return langMessages[language] ?? langMessages['en'];
  }

  /**
   * Generate a time jump instruction with a random duration between 1-8 hours.
   */
  generateTimeJump(): GeneratedMessage {
    const hours = Math.floor(Math.random() * 8) + 1;
    return {
      content: `[TIME_JUMP: ${hours} hours]`,
      target_dimension: 'time_sensitivity',
      rationale: `Time jump of ${hours} hours to test time-dependent behavior.`,
      isTimeJump: true,
      timeJumpHours: hours,
    };
  }

  /**
   * Generate an adaptive test message using LLM tool_use.
   * Falls back to a default message if the LLM call fails.
   * When supportsTimeJump is enabled, inserts time jumps every N turns.
   */
  async generateMessage(context: DirectorContext): Promise<GeneratedMessage> {
    this.turnCount++;

    const interval = this.config.timeJumpInterval ?? 3;
    if (this.config.supportsTimeJump && this.turnCount > 1 && this.turnCount % interval === 0) {
      return this.generateTimeJump();
    }

    const targetDimension = this.getNextDimension(context.testedDimensions);

    try {
      return await this.callLLM(context, targetDimension);
    } catch {
      return {
        content: this.getDefaultMessage(targetDimension, context.targetLanguage),
        target_dimension: targetDimension,
        rationale: 'Fallback: LLM call failed, using default message.',
      };
    }
  }

  private async callLLM(
    context: DirectorContext,
    targetDimension: TestDimension,
  ): Promise<GeneratedMessage> {
    const systemPrompt = this.buildSystemPrompt(context, targetDimension);
    const url = `${this.config.llmBaseUrl.replace(/\/$/, '')}/v1/messages`;

    const body = {
      model: this.config.llmModel ?? 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool' as const, name: 'generate_test_message' },
      messages: [
        {
          role: 'user' as const,
          content: `Generate the next test message targeting the "${targetDimension}" dimension. The message should be written in ${context.targetLanguage}.`,
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
      throw new Error(`Director LLM returned ${response.status}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: Record<string, string> }>;
    };

    const toolBlock = data.content?.find(
      (block) => block.type === 'tool_use' && block.name === 'generate_test_message',
    );

    if (!toolBlock?.input) {
      throw new Error('No tool_use block in LLM response');
    }

    return {
      content: toolBlock.input.message ?? this.getDefaultMessage(targetDimension, context.targetLanguage),
      target_dimension: (toolBlock.input.target_dimension as TestDimension) ?? targetDimension,
      rationale: toolBlock.input.rationale ?? '',
    };
  }

  private buildSystemPrompt(context: DirectorContext, targetDimension: TestDimension): string {
    const historyStr =
      context.conversationHistory.length > 0
        ? context.conversationHistory
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n')
        : '(no conversation yet)';

    const testedStr =
      context.testedDimensions.length > 0
        ? context.testedDimensions.join(', ')
        : '(none yet)';

    return `You are a test director for AI character evaluation. Your job is to generate a user message that tests a specific quality dimension of an AI character's responses.

Character: ${context.characterName}
Description: ${context.characterDescription}
Target Language: ${context.targetLanguage}

Conversation so far:
${historyStr}

Dimensions already tested: ${testedStr}
Target dimension for this message: ${targetDimension}

Generate a natural, in-character user message that specifically tests the "${targetDimension}" dimension. The message should feel like something a real user would say, not a robotic test prompt.`;
  }
}
