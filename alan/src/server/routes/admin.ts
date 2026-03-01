import { Hono } from 'hono';
import { importCard } from '../../card-import/index.js';
import { callImportLLM } from '../../card-import/import-llm.js';
import type { AlanEngine } from '../engine.js';

export function adminRoutes(engine: AlanEngine) {
  const app = new Hono();

  app.post('/admin/reimport', async (c) => {
    const body = await c.req.json<{ card_path?: string }>().catch(() => ({} as { card_path?: string }));
    const cardPath = body.card_path;

    if (!cardPath) {
      return c.json({ status: 'error', message: 'card_path is required' }, 400);
    }

    try {
      const config = engine.config;
      const workspacePath = config.workspace_path;

      // 1. Re-import card (preserves MEMORY.md, emotion_state.md)
      const result = await importCard(cardPath, workspacePath, {
        reimport: true,
        embeddingConfig: config.embedding_url
          ? { baseUrl: config.embedding_url }
          : undefined,
      });

      // 2. Run Import LLM to regenerate IMPULSE.md and SOUL.md
      const llmResult = await callImportLLM(config, workspacePath);

      return c.json({
        status: 'ok',
        import: {
          wi_count: result.wi_count,
          detected_language: result.detected_language,
        },
        import_llm: llmResult ? 'success' : 'skipped_or_failed',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ status: 'error', message }, 500);
    }
  });

  app.post('/admin/archive', async (c) => {
    try {
      const count = engine.chatHistory.archive();
      return c.json({ status: 'ok', archived_count: count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ status: 'error', message }, 500);
    }
  });

  app.post('/admin/life-simulate', async (c) => {
    try {
      const result = await engine.run({
        trigger: 'cron',
        content: '[LifeSimulation] Periodic activity check',
        timestamp: new Date().toISOString(),
      });
      return c.json({
        status: 'ok',
        decision: result.decision,
        actions: result.actions.map(a => a.type),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ status: 'error', message }, 500);
    }
  });

  return app;
}
