import { Hono } from 'hono';
import { importCard } from '../../card-import/index.js';
import { callImportLLM } from '../../card-import/import-llm.js';
import { sendMessage as sendSTMessage } from '../../testing/st-client.js';
import { Judge } from '../../testing/judge.js';
import type { AlanEngine } from '../engine.js';

interface QuickEvalRequest {
  prompts?: string[];
  st?: { base_url?: string; api_key?: string; character_name?: string };
  judge?: {
    base_url?: string;
    model?: string;
    api_key?: string;
    character_name?: string;
    character_description?: string;
    expected_language?: string;
    consensus?: number;
  };
}

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

  app.post('/admin/eval/quick', async (c) => {
    const body = await c.req.json<QuickEvalRequest>().catch(() => ({} as QuickEvalRequest));

    const prompts = (body.prompts ?? []).filter((p: string) => p.trim().length > 0);
    if (prompts.length === 0) {
      return c.json({ status: 'error', message: 'prompts is required and must be non-empty' }, 400);
    }

    try {
      const alanReplies: Array<{ prompt: string; reply: string; latency_ms: number }> = [];
      for (const prompt of prompts) {
        const start = Date.now();
        const result = await engine.run({
          trigger: 'user_message',
          content: prompt,
          timestamp: new Date().toISOString(),
        });
        alanReplies.push({
          prompt,
          reply: result.reply ?? '',
          latency_ms: Date.now() - start,
        });
      }

      let stReplies: Array<{ prompt: string; reply: string; latency_ms: number }> | undefined;
      if (body.st?.base_url) {
        stReplies = [];
        for (const prompt of prompts) {
          const res = await sendSTMessage(prompt, {
            baseUrl: body.st.base_url,
            apiKey: body.st.api_key,
          }, body.st.character_name);
          stReplies.push({
            prompt,
            reply: res.text,
            latency_ms: res.latency_ms,
          });
        }
      }

      let alanScores: number[] | undefined;
      let stScores: number[] | undefined;
      if (body.judge?.base_url) {
        const judge = new Judge({
          llmBaseUrl: body.judge.base_url,
          llmModel: body.judge.model,
          apiKey: body.judge.api_key,
          consensusCount: body.judge.consensus ?? 3,
        });
        const characterName = body.judge.character_name ?? engine.config.agent_id;
        const expectedLanguage = body.judge.expected_language ?? engine.config.character_language;
        const description = body.judge.character_description ?? 'Roleplay character';

        alanScores = [];
        for (const item of alanReplies) {
          const verdict = await judge.evaluate({
            characterName,
            characterDescription: description,
            conversationHistory: [{ role: 'user', content: item.prompt }],
            replyToEvaluate: item.reply,
            expectedLanguage,
          });
          alanScores.push(verdict.overall);
        }

        if (stReplies) {
          stScores = [];
          for (const item of stReplies) {
            const verdict = await judge.evaluate({
              characterName,
              characterDescription: description,
              conversationHistory: [{ role: 'user', content: item.prompt }],
              replyToEvaluate: item.reply,
              expectedLanguage,
            });
            stScores.push(verdict.overall);
          }
        }
      }

      const avg = (values: number[] | undefined) =>
        values && values.length > 0
          ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3))
          : undefined;

      return c.json({
        status: 'ok',
        prompts: prompts.length,
        alan: {
          replies: alanReplies,
          avg_latency_ms: avg(alanReplies.map((r) => r.latency_ms)),
          avg_judge_score: avg(alanScores),
        },
        st: stReplies
          ? {
              replies: stReplies,
              avg_latency_ms: avg(stReplies.map((r) => r.latency_ms)),
              avg_judge_score: avg(stScores),
            }
          : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ status: 'error', message }, 500);
    }
  });

  return app;
}
