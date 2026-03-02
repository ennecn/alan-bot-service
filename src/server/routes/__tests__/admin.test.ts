import { describe, it, expect, vi } from 'vitest';
import { adminRoutes } from '../admin.js';
import type { AlanEngine } from '../../engine.js';

function makeEngineStub() {
  const run = vi.fn(async (event: { content: string }) => ({
    decision: 'reply',
    actions: [{ type: 'reply', content: `echo:${event.content}` }],
    reply: `echo:${event.content}`,
  }));

  return {
    config: {
      agent_id: 'test-agent',
      character_language: 'en',
    },
    run,
    chatHistory: {
      archive: vi.fn(() => 0),
    },
  } as unknown as AlanEngine & { run: typeof run };
}

describe('adminRoutes quick eval', () => {
  it('returns 400 when prompts missing', async () => {
    const app = adminRoutes(makeEngineStub());
    const res = await app.request('/admin/eval/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('runs alan quick eval with prompts', async () => {
    const engine = makeEngineStub();
    const app = adminRoutes(engine);
    const res = await app.request('/admin/eval/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts: ['hello', 'how are you'],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      alan: { replies: Array<{ prompt: string; reply: string }> };
      st: null;
    };
    expect(body.status).toBe('ok');
    expect(body.alan.replies).toHaveLength(2);
    expect(body.alan.replies[0].reply).toBe('echo:hello');
    expect(body.st).toBeNull();
    expect(engine.run.mock.calls.length).toBe(2);
  });
});
