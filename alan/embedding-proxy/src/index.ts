import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { embedSingle, embedBatch, cacheSize } from './siliconflow.js';

const PORT = parseInt(process.env.EMBEDDING_PROXY_PORT ?? '8098', 10);
const startTime = Date.now();

const app = new Hono();

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    cache_size: cacheSize(),
  });
});

app.post('/embed', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text || typeof text !== 'string') {
    return c.json({ error: 'text field required' }, 400);
  }
  const embedding = await embedSingle(text);
  return c.json({ embedding, dimensions: embedding.length });
});

app.post('/batch', async (c) => {
  const { texts } = await c.req.json<{ texts: string[] }>();
  if (!Array.isArray(texts) || texts.length === 0) {
    return c.json({ error: 'texts array required' }, 400);
  }
  const embeddings = await embedBatch(texts);
  return c.json({ embeddings });
});

serve({ fetch: app.fetch, hostname: '0.0.0.0', port: PORT }, () => {
  console.log(`[embedding-proxy] listening on 0.0.0.0:${PORT}`);
});
