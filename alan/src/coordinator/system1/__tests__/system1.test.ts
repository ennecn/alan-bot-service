import { describe, it, expect } from 'vitest';
import { PROCESS_EVENT_TOOL } from '../schema.js';
import { buildSystem1Prompt } from '../prompt.js';
import { sanitizeOutput } from '../client.js';
import type { System1PromptParams } from '../types.js';
import type { EmotionState } from '../../../types/index.js';

const baseParams: System1PromptParams = {
  characterFilter: 'A cheerful girl who loves cats.',
  emotionState: { joy: 0.6, sadness: 0.1, anger: 0.0, anxiety: 0.2, longing: 0.3, trust: 0.7 },
  eventContent: 'Hello, how are you today?',
  triggerType: 'user_message',
  wiCandidates: [
    { id: 'wi_1', summary: 'Cats are her favorite animals.' },
    { id: 'wi_2', summary: 'She lives in Tokyo.' },
  ],
  language: 'zh',
  previousImpulse: null,
};

describe('PROCESS_EVENT_TOOL schema', () => {
  it('has correct tool name', () => {
    expect(PROCESS_EVENT_TOOL.name).toBe('process_event');
  });

  it('has all required fields in input_schema', () => {
    const required = PROCESS_EVENT_TOOL.input_schema.required;
    expect(required).toContain('event_classification');
    expect(required).toContain('emotional_interpretation');
    expect(required).toContain('cognitive_projection');
    expect(required).toContain('wi_expansion');
    expect(required).toContain('impulse_narrative');
    expect(required).toContain('memory_consolidation');
  });

  it('event_classification.importance has correct enum values', () => {
    const props = PROCESS_EVENT_TOOL.input_schema.properties;
    const importance = (props.event_classification as any).properties.importance;
    expect(importance.enum).toEqual([0.0, 0.3, 0.6, 1.0]);
  });
});

describe('buildSystem1Prompt', () => {
  it('returns system prompt in English', () => {
    const result = buildSystem1Prompt(baseParams);
    expect(result.system).toContain('cognitive filter');
    expect(result.system).toContain('process_event');
  });

  it('includes character filter in system prompt', () => {
    const result = buildSystem1Prompt(baseParams);
    expect(result.system).toContain('cheerful girl who loves cats');
  });

  it('includes emotion state in user message', () => {
    const result = buildSystem1Prompt(baseParams);
    const content = result.messages[0].content;
    expect(content).toContain('joy: 0.600');
    expect(content).toContain('trust: 0.700');
  });

  it('wraps event content with nonce separators', () => {
    const result = buildSystem1Prompt(baseParams);
    const content = result.messages[0].content;
    expect(content).toMatch(/<<<EVENT_START_[0-9a-f]{8}>>>/);
    expect(content).toMatch(/<<<EVENT_END_[0-9a-f]{8}>>>/);
    expect(content).toContain('Hello, how are you today?');
  });

  it('generates different nonces per call', () => {
    const r1 = buildSystem1Prompt(baseParams);
    const r2 = buildSystem1Prompt(baseParams);
    const nonce1 = r1.messages[0].content.match(/EVENT_START_([0-9a-f]{8})/)?.[1];
    const nonce2 = r2.messages[0].content.match(/EVENT_START_([0-9a-f]{8})/)?.[1];
    expect(nonce1).not.toBe(nonce2);
  });

  it('includes WI candidates', () => {
    const result = buildSystem1Prompt(baseParams);
    const content = result.messages[0].content;
    expect(content).toContain('[wi_1]');
    expect(content).toContain('Cats are her favorite');
  });

  it('includes language instruction for impulse_narrative', () => {
    const result = buildSystem1Prompt(baseParams);
    expect(result.system).toContain('Chinese (Mandarin)');
  });

  it('includes previous impulse when provided', () => {
    const params = { ...baseParams, previousImpulse: 'I feel a strong urge to reply.' };
    const result = buildSystem1Prompt(params);
    expect(result.messages[0].content).toContain('Previous Impulse');
    expect(result.messages[0].content).toContain('strong urge to reply');
  });

  it('omits previous impulse section when null', () => {
    const result = buildSystem1Prompt(baseParams);
    expect(result.messages[0].content).not.toContain('Previous Impulse');
  });
});

describe('sanitizeOutput', () => {
  it('parses valid tool output', () => {
    const raw = {
      event_classification: { type: 'user_message', importance: 0.6 },
      emotional_interpretation: { joy: 0.2, sadness: -0.1 },
      cognitive_projection: 'They seem friendly.',
      wi_expansion: ['wi_3'],
      impulse_narrative: '想要回复',
      memory_consolidation: { should_save: true, summary: 'User greeted me.' },
    };
    const result = sanitizeOutput(raw);
    expect(result.event_classification.type).toBe('user_message');
    expect(result.event_classification.importance).toBe(0.6);
    expect(result.emotional_interpretation.joy).toBe(0.2);
    expect(result.cognitive_projection).toBe('They seem friendly.');
    expect(result.wi_expansion).toEqual(['wi_3']);
    expect(result.memory_consolidation.should_save).toBe(true);
  });

  it('clamps emotional deltas to ±0.3', () => {
    const raw = {
      event_classification: { type: 'user_message', importance: 0.3 },
      emotional_interpretation: { joy: 0.8, anger: -0.9 },
      cognitive_projection: '',
      wi_expansion: [],
      impulse_narrative: '',
      memory_consolidation: { should_save: false, summary: '' },
    };
    const result = sanitizeOutput(raw);
    expect(result.emotional_interpretation.joy).toBe(0.3);
    expect(result.emotional_interpretation.anger).toBe(-0.3);
  });

  it('snaps invalid importance to nearest valid value', () => {
    const raw = {
      event_classification: { type: 'system', importance: 0.5 },
      emotional_interpretation: {},
      cognitive_projection: '',
      wi_expansion: [],
      impulse_narrative: '',
      memory_consolidation: { should_save: false, summary: '' },
    };
    const result = sanitizeOutput(raw);
    // 0.5 is equidistant from 0.3 and 0.6; nearest picks 0.6 (checked in order, 0.3 dist=0.2, 0.6 dist=0.1)
    expect(result.event_classification.importance).toBe(0.6);
  });

  it('handles missing fields gracefully', () => {
    const result = sanitizeOutput({});
    expect(result.event_classification.type).toBe('system');
    expect(result.event_classification.importance).toBe(0.0);
    expect(result.emotional_interpretation).toEqual({});
    expect(result.cognitive_projection).toBe('');
    expect(result.wi_expansion).toEqual([]);
    expect(result.impulse_narrative).toBe('');
    expect(result.memory_consolidation.should_save).toBe(false);
  });

  it('filters non-string values from wi_expansion', () => {
    const raw = {
      event_classification: { type: 'system', importance: 0.0 },
      emotional_interpretation: {},
      cognitive_projection: '',
      wi_expansion: ['valid', 123, null, 'also_valid'],
      impulse_narrative: '',
      memory_consolidation: { should_save: false, summary: '' },
    };
    const result = sanitizeOutput(raw);
    expect(result.wi_expansion).toEqual(['valid', 'also_valid']);
  });

  it('ignores unknown emotion dimensions', () => {
    const raw = {
      event_classification: { type: 'system', importance: 0.0 },
      emotional_interpretation: { joy: 0.1, fake_emotion: 0.5 },
      cognitive_projection: '',
      wi_expansion: [],
      impulse_narrative: '',
      memory_consolidation: { should_save: false, summary: '' },
    };
    const result = sanitizeOutput(raw);
    expect(result.emotional_interpretation.joy).toBe(0.1);
    expect('fake_emotion' in result.emotional_interpretation).toBe(false);
  });
});
