import { describe, it, expect } from 'vitest';
import { PromptCompiler } from '../src/compiler/index.js';
import { defaultConfig } from '../src/config.js';
import type { Engine, EngineContext, PromptFragment } from '../src/types.js';

const mockContext: EngineContext = {
  agentId: 'test-agent',
  message: {
    id: 'msg-1', channel: 'telegram',
    author: { id: 'user-1', name: 'User', isBot: false },
    content: 'hello', timestamp: Date.now(),
  },
  conversationHistory: [],
};

function makeEngine(name: string, fragments: PromptFragment[]): Engine {
  return {
    name,
    getPromptFragments: async () => fragments,
  };
}

describe('PromptCompiler', () => {
  it('should include base system prompt', async () => {
    const compiler = new PromptCompiler(defaultConfig);
    const result = await compiler.compile('You are a helpful agent.', mockContext);
    expect(result).toContain('You are a helpful agent.');
  });

  it('should include engine fragments sorted by section order', async () => {
    const compiler = new PromptCompiler(defaultConfig);

    compiler.registerEngine(makeEngine('memory', [{
      source: 'memory', content: '<memories>cat named 小花</memories>',
      priority: 60, tokens: 20, required: false,
    }]));
    compiler.registerEngine(makeEngine('identity', [{
      source: 'identity', content: '<identity>阿凛</identity>',
      priority: 80, tokens: 10, required: true,
    }]));

    const result = await compiler.compile('Base prompt.', mockContext);

    // Identity should come before memory in final output
    const identityPos = result.indexOf('<identity>');
    const memoryPos = result.indexOf('<memories>');
    expect(identityPos).toBeLessThan(memoryPos);
  });

  it('should respect token budget', async () => {
    const smallBudgetConfig = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, maxContextTokens: 100 },
    };
    const compiler = new PromptCompiler(smallBudgetConfig);

    // This fragment is way too large for the budget
    compiler.registerEngine(makeEngine('memory', [{
      source: 'memory', content: 'x'.repeat(1000),
      priority: 50, tokens: 500, required: false,
    }]));

    const result = await compiler.compile('Base.', smallBudgetConfig as any);
    // The large fragment should be excluded
    expect(result).not.toContain('x'.repeat(1000));
  });

  it('should use fallback when engine fails', async () => {
    const compiler = new PromptCompiler(defaultConfig);

    const failingEngine: Engine = {
      name: 'broken',
      getPromptFragments: async () => { throw new Error('engine down'); },
      fallback: () => [{
        source: 'memory', content: '[memory unavailable]',
        priority: 10, tokens: 5, required: false,
      }],
    };

    compiler.registerEngine(failingEngine);
    const result = await compiler.compile('Base.', mockContext);
    expect(result).toContain('[memory unavailable]');
  });

  it('should prioritize required fragments', async () => {
    const tinyConfig = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, maxContextTokens: 50 },
    };
    const compiler = new PromptCompiler(tinyConfig);

    compiler.registerEngine(makeEngine('test', [
      { source: 'identity', content: 'REQUIRED', priority: 10, tokens: 5, required: true },
      { source: 'memory', content: 'OPTIONAL-HIGH', priority: 90, tokens: 5, required: false },
    ]));

    const result = await compiler.compile('B', mockContext);
    expect(result).toContain('REQUIRED');
  });
});
