import { describe, it, expect } from 'vitest';
import { assemble, LITERARY_BASE } from '../prompt-assembler.js';
import type { AssemblyParams } from '../prompt-assembler.js';

function makeParams(overrides: Partial<AssemblyParams> = {}): AssemblyParams {
  return {
    systemPrompt: 'You are a test character.',
    soulMd: '',
    mesExample: '',
    constantWI: [],
    impulseMd: '',
    emotionNarrative: '感受到安静的喜悦。',
    activatedWI: [],
    chatHistory: [{ role: 'user', content: 'hello' }],
    postHistoryInstructions: '',
    ...overrides,
  };
}

describe('assembler quality block', () => {
  it('injects LITERARY_BASE when outputStyle is default', () => {
    const result = assemble(makeParams({ outputStyle: 'default', language: 'zh' }));
    expect(result.system).toContain('展示而非叙述');
    expect(result.system).toContain('show don\'t tell');
  });

  it('injects LITERARY_BASE when outputStyle is omitted', () => {
    const result = assemble(makeParams({ language: 'zh' }));
    expect(result.system).toContain('展示而非叙述');
  });

  it('does NOT inject LITERARY_BASE when outputStyle is casual', () => {
    const result = assemble(makeParams({ outputStyle: 'casual', language: 'zh' }));
    expect(result.system).not.toContain('展示而非叙述');
    expect(result.system).not.toContain('Writing Quality');
  });

  it('injects writingDirective when outputStyle is default', () => {
    const directive = '用留白和省略传达沉重感。';
    const result = assemble(makeParams({
      outputStyle: 'default',
      language: 'zh',
      writingDirective: directive,
    }));
    expect(result.system).toContain(directive);
    expect(result.system).toContain('展示而非叙述'); // also has base
  });

  it('does NOT inject writingDirective when outputStyle is casual', () => {
    const directive = '用留白和省略传达沉重感。';
    const result = assemble(makeParams({
      outputStyle: 'casual',
      language: 'zh',
      writingDirective: directive,
    }));
    expect(result.system).not.toContain(directive);
  });

  it('uses correct language for LITERARY_BASE', () => {
    const enResult = assemble(makeParams({ outputStyle: 'default', language: 'en' }));
    expect(enResult.system).toContain('Show don\'t tell');
    expect(enResult.system).not.toContain('展示而非叙述');

    const jaResult = assemble(makeParams({ outputStyle: 'default', language: 'ja' }));
    expect(jaResult.system).toContain('語りではなく描写');
  });

  it('wraps emotion narrative with framing tag', () => {
    const result = assemble(makeParams({
      emotionNarrative: '感受到安静的喜悦。',
      language: 'zh',
    }));
    expect(result.system).toContain('[角色内心状态——写作参考，不要直接写出]');
    expect(result.system).toContain('感受到安静的喜悦。');
  });

  it('uses en framing tag for english', () => {
    const result = assemble(makeParams({
      emotionNarrative: 'Feeling quiet happiness.',
      language: 'en',
    }));
    expect(result.system).toContain('[Character inner state');
    expect(result.system).toContain('do not quote directly');
  });

  it('LITERARY_BASE constant covers all three languages', () => {
    expect(LITERARY_BASE.zh).toBeTruthy();
    expect(LITERARY_BASE.en).toBeTruthy();
    expect(LITERARY_BASE.ja).toBeTruthy();
    expect(LITERARY_BASE.zh).toContain('展示而非叙述');
    expect(LITERARY_BASE.en).toContain('Show don\'t tell');
    expect(LITERARY_BASE.ja).toContain('語りではなく描写');
  });

  it('quality block appears before impulse in L3', () => {
    const result = assemble(makeParams({
      outputStyle: 'default',
      language: 'zh',
      impulseMd: '# Impulse\nvalue: 0.7',
      writingDirective: '用留白和省略传达沉重感。',
    }));
    const qualityIdx = result.system.indexOf('写作质量要求');
    const impulseIdx = result.system.indexOf('# Impulse');
    expect(qualityIdx).toBeGreaterThan(-1);
    expect(impulseIdx).toBeGreaterThan(-1);
    expect(qualityIdx).toBeLessThan(impulseIdx);
  });
});
