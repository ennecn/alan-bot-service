import { describe, it, expect } from 'vitest';
import { mapSocialEvent } from '../event-mapper.js';
import type { SocialEvent } from '../types.js';

function makeEvent(overrides: Partial<SocialEvent>): SocialEvent {
  return {
    id: 'evt-1',
    source_agent: 'alice',
    target_agent: null,
    type: 'social_post',
    payload: {},
    created_at: '2026-01-01T00:00:00.000Z',
    delivered_at: null,
    ...overrides,
  };
}

describe('mapSocialEvent', () => {
  it('maps social_post to social_notification', () => {
    const result = mapSocialEvent(makeEvent({
      type: 'social_post',
      payload: { content: 'Hello world' },
    }));
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('social_notification');
    expect(result!.content).toContain('alice');
    expect(result!.content).toContain('Hello world');
  });

  it('maps fact_update to fact_sync', () => {
    const result = mapSocialEvent(makeEvent({
      type: 'fact_update',
      payload: { content: 'New fact' },
    }));
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('fact_sync');
    expect(result!.content).toContain('New fact');
  });

  it('maps reaction to social_notification', () => {
    const result = mapSocialEvent(makeEvent({
      type: 'reaction',
      payload: { type: 'like', content: 'Great post' },
    }));
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('social_notification');
    expect(result!.content).toContain('like');
  });

  it('maps life_event to social_notification', () => {
    const result = mapSocialEvent(makeEvent({
      type: 'life_event',
      payload: { content: 'Went for a walk' },
    }));
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe('social_notification');
    expect(result!.content).toContain('Went for a walk');
  });

  it('returns null for unknown event types', () => {
    const result = mapSocialEvent(makeEvent({
      type: 'emotion_shift' as any,
    }));
    expect(result).toBeNull();
  });

  it('uses created_at as timestamp', () => {
    const result = mapSocialEvent(makeEvent({
      type: 'social_post',
      created_at: '2026-03-01T12:00:00.000Z',
    }));
    expect(result!.timestamp).toBe('2026-03-01T12:00:00.000Z');
  });
});
