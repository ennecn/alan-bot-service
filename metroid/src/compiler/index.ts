import type { Engine, EngineContext, PromptFragment } from '../types.js';
import type { MetroidConfig } from '../config.js';

/**
 * Prompt Compiler: assembles final prompt from engine fragments.
 *
 * Priority-based greedy packing within token budget.
 * Phase 1: fixed budget allocation, no dynamic adjustment.
 */
export class PromptCompiler {
  private engines: Engine[] = [];

  constructor(private config: MetroidConfig) {}

  registerEngine(engine: Engine): void {
    this.engines.push(engine);
  }

  /**
   * Compile the final system prompt from all engine fragments.
   * Returns assembled prompt string.
   */
  async compile(
    baseSystemPrompt: string,
    context: EngineContext,
  ): Promise<string> {
    const maxTokens = this.config.llm.maxContextTokens;
    const budget = Math.floor(maxTokens * (1 - this.config.compiler.responseReserveRatio));

    // Base system prompt is always included
    const baseTokens = this.estimateTokens(baseSystemPrompt);
    let remainingBudget = budget - baseTokens;

    // Gather fragments from all engines (with fallback)
    const allFragments: PromptFragment[] = [];
    for (const engine of this.engines) {
      try {
        const fragments = await engine.getPromptFragments(context);
        allFragments.push(...fragments);
      } catch (err) {
        console.error(`[Compiler] ${engine.name} failed, using fallback:`, err);
        if (engine.fallback) {
          allFragments.push(...engine.fallback());
        }
      }
    }

    // Required fragments first, then sort by priority
    const required = allFragments.filter(f => f.required);
    const optional = allFragments
      .filter(f => !f.required)
      .sort((a, b) => b.priority - a.priority);

    const included: PromptFragment[] = [];

    // Include all required fragments
    for (const f of required) {
      if (f.tokens <= remainingBudget) {
        included.push(f);
        remainingBudget -= f.tokens;
      }
    }

    // Greedily pack optional fragments by priority
    for (const f of optional) {
      if (f.tokens <= remainingBudget) {
        included.push(f);
        remainingBudget -= f.tokens;
      }
    }

    // Assemble final prompt
    const sections = included
      .sort((a, b) => this.sectionOrder(a.source) - this.sectionOrder(b.source))
      .map(f => f.content);

    return [baseSystemPrompt, ...sections].join('\n\n');
  }

  /** Notify all engines after LLM response */
  async onResponse(response: string, context: EngineContext): Promise<void> {
    await Promise.allSettled(
      this.engines
        .filter(e => e.onResponse)
        .map(e => e.onResponse!(response, context))
    );
  }

  /** Rough token estimation: ~4 chars per token for mixed CJK/English */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }

  /** Ordering for final prompt assembly */
  private sectionOrder(source: string): number {
    const order: Record<string, number> = {
      identity: 0,
      emotion: 1,
      world: 2,
      memory: 3,
      tool: 4,
    };
    return order[source] ?? 5;
  }
}
