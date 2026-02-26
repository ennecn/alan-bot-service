import { describe, it, expect } from 'vitest';
import { DeliveryAdapter } from '../adapters/delivery.js';
import type { DeliveryPayload } from '../adapters/delivery.js';
import type { Action } from '../../types/actions.js';

describe('DeliveryAdapter', () => {
  it('reply returns content in payload', async () => {
    const adapter = new DeliveryAdapter();
    const action: Action = { type: 'reply', content: 'Hello world' };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
    const payload = result.payload as DeliveryPayload;
    expect(payload.content).toBe('Hello world');
  });

  it('hesitate returns "..." with retraction metadata', async () => {
    const adapter = new DeliveryAdapter();
    const action: Action = { type: 'hesitate' };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
    const payload = result.payload as DeliveryPayload;
    expect(payload.content).toBe('...');
    expect(payload.retraction).toBeDefined();
    expect(payload.retraction!.delay_ms).toBeGreaterThanOrEqual(2000);
    expect(payload.retraction!.delay_ms).toBeLessThanOrEqual(5000);
  });

  it('suppress returns "HEARTBEAT_OK"', async () => {
    const adapter = new DeliveryAdapter();
    const action: Action = { type: 'suppress' };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
    const payload = result.payload as DeliveryPayload;
    expect(payload.content).toBe('HEARTBEAT_OK');
  });

  it('multi-message: content with delimiter splits into segments with delays', async () => {
    const adapter = new DeliveryAdapter();
    const action: Action = { type: 'reply', content: 'Part one\n\n---\n\nPart two\n\n---\n\nPart three' };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
    const payload = result.payload as DeliveryPayload;
    expect(payload.content).toBe('Part one');
    expect(payload.delayed.length).toBe(2);
    expect(payload.delayed[0].content).toBe('Part two');
    expect(payload.delayed[1].content).toBe('Part three');
  });

  it('multi-message: first segment is immediate, rest are in delayed[]', async () => {
    const adapter = new DeliveryAdapter();
    const action: Action = { type: 'reply', content: 'First\n\n---\n\nSecond' };
    const result = await adapter.execute(action);
    const payload = result.payload as DeliveryPayload;
    expect(payload.content).toBe('First');
    expect(payload.delayed.length).toBe(1);
    expect(payload.delayed[0].content).toBe('Second');
    expect(payload.delayed[0].delay).toBeGreaterThan(0);
  });

  it('multi-message: single segment (no delimiter) returns normally', async () => {
    const adapter = new DeliveryAdapter();
    const action: Action = { type: 'reply', content: 'Just one message' };
    const result = await adapter.execute(action);
    const payload = result.payload as DeliveryPayload;
    expect(payload.content).toBe('Just one message');
    expect(payload.delayed).toEqual([]);
  });

  it('retractHesitation returns edit action', () => {
    const adapter = new DeliveryAdapter();
    const result = adapter.retractHesitation('msg-123');
    expect(result.action).toBe('edit');
    expect(result.content).toBe('');
  });

  it('splitMultiMessage static method works correctly', () => {
    expect(DeliveryAdapter.splitMultiMessage('a\n\n---\n\nb')).toEqual(['a', 'b']);
    expect(DeliveryAdapter.splitMultiMessage('single')).toEqual(['single']);
    expect(DeliveryAdapter.splitMultiMessage('a\n\n---\n\nb\n\n---\n\nc')).toEqual(['a', 'b', 'c']);
    expect(DeliveryAdapter.splitMultiMessage('')).toEqual(['']);
  });
});
