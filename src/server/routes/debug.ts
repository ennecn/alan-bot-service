import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { AlanEngine } from '../engine.js';

export function debugRoutes(engine: AlanEngine) {
  const app = new Hono();

  app.get('/debug/emotion', (c) => {
    const snapshot = engine.emotionStore.read(engine.config.workspace_path);
    if (!snapshot) {
      return c.json({ error: 'no emotion state found' }, 404);
    }
    return c.json(snapshot);
  });

  app.get('/debug/impulse', (c) => {
    const impulsePath = path.join(engine.config.workspace_path, 'IMPULSE.md');
    try {
      const content = fs.readFileSync(impulsePath, 'utf-8');
      return c.json({ raw: content });
    } catch {
      return c.json({ error: 'no IMPULSE.md found' }, 404);
    }
  });

  app.get('/debug/wi', (c) => {
    const entries = engine.wiStore.getAllEntries();
    return c.json({ activated: entries, total: entries.length });
  });

  app.get('/debug/metrics', (c) => {
    const last = parseInt(c.req.query('last') ?? '10', 10);
    const metrics = engine.metricsWriter.getRecent(last);
    return c.json({ metrics, count: metrics.length });
  });

  app.get('/debug/clock', (c) => {
    return c.json({
      now: new Date().toISOString(),
      uptime_s: Math.floor(process.uptime()),
      agent_id: engine.config.agent_id,
    });
  });

  return app;
}
