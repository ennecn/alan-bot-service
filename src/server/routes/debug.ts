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

  // Aggregated state snapshot — emotion + impulse + wi + card + preset + session
  app.get('/debug/state', (c) => {
    const wsPath = engine.config.workspace_path;

    // Emotion
    const emotion = engine.emotionStore.read(wsPath);

    // Impulse
    let impulse: string | null = null;
    const impulsePath = path.join(wsPath, 'IMPULSE.md');
    try { impulse = fs.readFileSync(impulsePath, 'utf-8'); } catch { /* missing */ }

    // WI count
    const wiEntries = engine.wiStore.getAllEntries();

    // Card data
    let cardData: unknown = null;
    const cardDataPath = path.join(wsPath, 'internal', 'card-data.json');
    try { cardData = JSON.parse(fs.readFileSync(cardDataPath, 'utf-8')); } catch { /* missing */ }

    // Active preset
    let preset: unknown = null;
    const presetPath = path.join(wsPath, 'internal', 'preset.json');
    try { preset = JSON.parse(fs.readFileSync(presetPath, 'utf-8')); } catch { /* missing */ }

    // Current session
    const sessions = engine.chatHistory.listSessions(1);

    // Active models
    let modelRegistry: unknown = null;
    const modelsPath = path.join(wsPath, 'internal', 'models.json');
    try { modelRegistry = JSON.parse(fs.readFileSync(modelsPath, 'utf-8')); } catch { /* missing */ }

    return c.json({
      emotion,
      impulse,
      wi: { total: wiEntries.length },
      card: cardData,
      preset,
      session: sessions[0] ?? null,
      models: {
        s1: { base_url: engine.config.system1_base_url, model: engine.config.system1_model },
        s2: { base_url: engine.config.system2_base_url, model: engine.config.system2_model },
        registry: modelRegistry,
      },
      agent_id: engine.config.agent_id,
      uptime_s: Math.floor(process.uptime()),
    });
  });

  return app;
}
