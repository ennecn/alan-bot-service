import type { Engine, EngineContext, PromptFragment, AgentMode } from '../types.js';
import type { MetroidConfig } from '../config.js';

/**
 * Prompt Compiler: assembles final prompt from engine fragments.
 *
 * Two modes:
 * - Classic: ST-style assembly with position/depth ordering
 * - Enhanced: priority-based greedy packing within token budget
 */
export class PromptCompiler {
  private engines: Engine[] = [];

  constructor(private config: MetroidConfig) {}

  registerEngine(engine: Engine): void {
    this.engines.push(engine);
  }

  /**
   * Compile the final system prompt from all engine fragments.
   */
  async compile(
    baseSystemPrompt: string,
    context: EngineContext,
  ): Promise<string> {
    const details = await this.compileWithDetails(baseSystemPrompt, context);
    return details.compiledPrompt;
  }

  /**
   * Compile prompt and return full breakdown for debugging/inspection.
   */
  async compileWithDetails(
    baseSystemPrompt: string,
    context: EngineContext,
  ): Promise<{
    compiledPrompt: string;
    fragments: PromptFragment[];
    basePrompt: string;
    tokenBudget: number;
    tokensUsed: number;
  }> {
    const maxTokens = this.config.llm.maxContextTokens;
    const budget = Math.floor(maxTokens * (1 - this.config.compiler.responseReserveRatio));
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

    const compiledPrompt = context.mode === 'classic'
      ? this.assembleClassic(baseSystemPrompt, allFragments, remainingBudget)
      : this.assembleEnhanced(baseSystemPrompt, allFragments, remainingBudget);

    const tokensUsed = this.estimateTokens(compiledPrompt);

    return {
      compiledPrompt,
      fragments: allFragments,
      basePrompt: baseSystemPrompt,
      tokenBudget: budget,
      tokensUsed,
    };
  }

  /** Notify all engines after LLM response */
  async onResponse(response: string, context: EngineContext): Promise<void> {
    await Promise.allSettled(
      this.engines
        .filter(e => e.onResponse)
        .map(e => e.onResponse!(response, context))
    );
  }

  /**
   * Classic mode: ST-style assembly.
   * Order: before_char → identity → after_char → world(no position) → at_depth → before_an → after_an
   * Within same position, stable sources (identity, world) before dynamic (emotion, memory).
   */
  private assembleClassic(
    base: string,
    fragments: PromptFragment[],
    budget: number,
  ): string {
    // ST position ordering
    const posOrder: Record<string, number> = {
      before_char: 0,
      // identity fragments (no position) go at 1
      after_char: 2,
      at_depth: 3,
      before_an: 4,
      after_an: 5,
    };

    const sorted = [...fragments].sort((a, b) => {
      const aPos = a.position ? posOrder[a.position] ?? 3 : (a.source === 'identity' ? 1 : 3);
      const bPos = b.position ? posOrder[b.position] ?? 3 : (b.source === 'identity' ? 1 : 3);
      if (aPos !== bPos) return aPos - bPos;
      // Within same position: stable sources first for cache friendliness
      const aStable = this.sectionOrder(a.source);
      const bStable = this.sectionOrder(b.source);
      if (aStable !== bStable) return aStable - bStable;
      return b.priority - a.priority;
    });

    const included: PromptFragment[] = [];
    let remaining = budget;

    for (const f of sorted) {
      if (f.required || f.tokens <= remaining) {
        included.push(f);
        remaining -= f.tokens;
      }
    }

    return [base, ...included.map(f => f.content)].join('\n\n');
  }

  /** Enhanced mode: priority-based greedy packing */
  private assembleEnhanced(
    base: string,
    fragments: PromptFragment[],
    budget: number,
  ): string {
    const required = fragments.filter(f => f.required);
    const optional = fragments
      .filter(f => !f.required)
      .sort((a, b) => b.priority - a.priority);

    const included: PromptFragment[] = [];
    let remaining = budget;

    for (const f of required) {
      if (f.tokens <= remaining) {
        included.push(f);
        remaining -= f.tokens;
      }
    }

    for (const f of optional) {
      if (f.tokens <= remaining) {
        included.push(f);
        remaining -= f.tokens;
      }
    }

    // Order by section type for readability
    const sections = included
      .sort((a, b) => this.sectionOrder(a.source) - this.sectionOrder(b.source))
      .map(f => f.content);

    return [base, ...sections].join('\n\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }

  /**
   * Section ordering optimized for KV cache hit rate.
   * Stable content first (identity, world, growth rarely change),
   * dynamic content last (emotion, memory change every turn).
   * This maximizes prefix cache reuse across conversation turns.
   */
  private sectionOrder(source: string): number {
    const order: Record<string, number> = {
      identity: 0,  // character card — never changes mid-conversation
      world: 1,     // lorebook/scenario — rarely changes
      growth: 2,    // behavioral changes — changes infrequently
      emotion: 3,   // PAD state — may change every turn
      memory: 4,    // retrieved memories — changes every turn
      tool: 5,
    };
    return order[source] ?? 5;
  }
}