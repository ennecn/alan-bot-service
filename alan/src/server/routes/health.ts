import { Hono } from 'hono';
import type { AlanConfig } from '../../types/actions.js';

export function healthRoutes(config: AlanConfig) {
  const app = new Hono();
  const startTime = Date.now();

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      agent_id: config.agent_id,
      last_coordinator_run_ms: null,
    });
  });

  return app;
}
