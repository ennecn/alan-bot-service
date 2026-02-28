/**
 * Social Layer HTTP server using Hono.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { EventBus } from './event-bus.js';
import { EventBusDB } from './event-bus-db.js';
import { AgentRegistry } from './agent-registry.js';
import { SocialPlatform } from './social-platform.js';
import { FactSync } from './fact-sync.js';
import { LifeSimulation } from './life-simulation.js';
import type { EventType } from './types.js';

export interface SocialServerOptions {
  dbPath?: string;
  /** Map of API key → agent ID for authentication. If provided, all routes except /health require X-EventBus-Key header. */
  apiKeys?: Map<string, string>;
}

export function createSocialServer(opts: SocialServerOptions | string = {}) {
  // Support legacy string-only signature
  const options: SocialServerOptions = typeof opts === 'string' ? { dbPath: opts } : opts;
  const resolvedDbPath = options.dbPath ?? process.env.ALAN_SOCIAL_DB ?? './social.db';
  const port = parseInt(process.env.ALAN_SOCIAL_PORT ?? '8099', 10);
  const apiKeys = options.apiKeys;

  const eventBusDb = new EventBusDB(resolvedDbPath);
  const registry = new AgentRegistry(eventBusDb);
  const eventBus = new EventBus(eventBusDb, registry);
  const platform = new SocialPlatform(resolvedDbPath);
  const factSync = new FactSync(eventBus);
  const lifeSim = new LifeSimulation(eventBus, registry);

  type Env = { Variables: { authenticatedAgent: string } };
  const app = new Hono<Env>();

  // --- Auth Middleware ---
  if (apiKeys) {
    app.use('*', async (c, next) => {
      // Skip auth for health endpoint
      if (c.req.path === '/health') return next();

      const key = c.req.header('x-eventbus-key');
      if (!key || !apiKeys.has(key)) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      c.set('authenticatedAgent', apiKeys.get(key)!);
      return next();
    });
  }

  // --- Events ---

  app.post('/events/publish', async (c) => {
    const body = await c.req.json<{
      source_agent: string;
      target_agent?: string | null;
      type: EventType;
      payload: Record<string, unknown>;
    }>();
    try {
      const event = eventBus.publish({
        source_agent: body.source_agent,
        target_agent: body.target_agent ?? null,
        type: body.type,
        payload: body.payload,
      });
      return c.json(event, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 422);
    }
  });

  app.get('/events/poll/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const events = eventBus.poll(agentId);
    return c.json(events);
  });

  // --- Agents ---

  app.post('/agents/register', async (c) => {
    const body = await c.req.json<{
      id: string;
      name: string;
      metadata?: Record<string, unknown>;
    }>();
    const agent = registry.register(body.id, body.name, body.metadata);
    return c.json(agent, 201);
  });

  app.post('/agents/heartbeat', async (c) => {
    const body = await c.req.json<{ id: string }>();
    registry.heartbeat(body.id);
    return c.json({ ok: true });
  });

  app.get('/agents', (c) => {
    return c.json(registry.getAllAgents());
  });

  app.get('/agents/:id', (c) => {
    const agent = registry.getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json(agent);
  });

  // --- Social Platform ---

  app.get('/social/posts', (c) => {
    const agentId = c.req.query('agent_id');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const posts = platform.getPosts(limit, agentId);
    return c.json(posts);
  });

  app.post('/social/posts', async (c) => {
    const body = await c.req.json<{
      agent_id: string;
      content: string;
      mood: string;
    }>();
    const post = platform.createPost(body.agent_id, body.content, body.mood);
    return c.json(post, 201);
  });

  app.post('/social/react', async (c) => {
    const body = await c.req.json<{
      post_id: string;
      agent_id: string;
      type: 'like' | 'comment';
      content?: string;
    }>();
    const reaction = platform.addReaction(
      body.post_id,
      body.agent_id,
      body.type,
      body.content,
    );
    return c.json(reaction, 201);
  });

  // --- Facts ---

  app.post('/facts/broadcast', async (c) => {
    const body = await c.req.json<{ source_agent: string; content: string }>();
    const fact = factSync.broadcast(body.source_agent, body.content);
    return c.json(fact, 201);
  });

  app.post('/facts/:id/accept', async (c) => {
    const body = await c.req.json<{ agent_id: string }>();
    factSync.accept(c.req.param('id'), body.agent_id);
    return c.json({ ok: true });
  });

  app.post('/facts/:id/reject', async (c) => {
    const body = await c.req.json<{ agent_id: string }>();
    factSync.reject(c.req.param('id'), body.agent_id);
    return c.json({ ok: true });
  });

  // --- Health ---

  app.get('/health', (c) => {
    const agents = registry.getAllAgents();
    const events = eventBusDb.getRecentEvents(1);
    return c.json({
      status: 'ok',
      agents: agents.length,
      events: events.length > 0 ? 'active' : 'empty',
    });
  });

  function start() {
    serve({ fetch: app.fetch, port }, () => {
      console.log(`[social-server] listening on port ${port}`);
    });
  }

  return { app, start, eventBus, registry, platform, factSync, lifeSim };
}
