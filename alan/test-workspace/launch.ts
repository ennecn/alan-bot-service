/**
 * First end-to-end launch of Alan Engine with real LLMs.
 *
 * Usage: npx tsx test-workspace/launch.ts
 *
 * Steps:
 *   1. Import test card into workspace
 *   2. Start engine on port 7088
 *   3. Ready to receive messages at POST /v1/messages
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCard } from '../src/card-import/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspacePath = path.join(__dirname, 'data');
const cardPath = path.join(__dirname, 'test-card.json');

// Set env vars before importing config
process.env.ALAN_PORT = '7088';
process.env.ALAN_WORKSPACE = workspacePath;
process.env.ALAN_S1_BASE_URL = 'https://coding.dashscope.aliyuncs.com/apps/anthropic';
process.env.ALAN_S2_BASE_URL = 'https://coding.dashscope.aliyuncs.com/apps/anthropic';
process.env.ALAN_S1_MODEL = 'glm-4.7';
process.env.ALAN_S2_MODEL = 'MiniMax-M2.5';
process.env.ALAN_S1_API_KEY = 'sk-sp-2b91f8df849d4a17a51269d2901aef6b';
process.env.ALAN_S2_API_KEY = 'sk-sp-2b91f8df849d4a17a51269d2901aef6b';
process.env.ALAN_EMBEDDING_URL = 'https://api.siliconflow.cn';
process.env.ALAN_EMBEDDING_API_KEY = 'sk-qylxcddwteqbqdmptzhtxhqlgyhmcgwlszaybqibwcpeatsd';
process.env.ALAN_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-4B';
process.env.ALAN_CHARACTER_LANGUAGE = 'zh';
process.env.ALAN_S2_MAX_TOKENS = '2000';

async function main() {
  // Step 1: Import card
  console.log('[launch] Importing card...');
  const result = await importCard(cardPath, workspacePath, {
    embeddingConfig: {
      baseUrl: process.env.ALAN_EMBEDDING_URL!,
      apiKey: process.env.ALAN_EMBEDDING_API_KEY,
      model: process.env.ALAN_EMBEDDING_MODEL,
    },
  });
  console.log(`[launch] Card imported: ${result.detected_language}, ${result.wi_count} WI entries`);

  // Step 2: Start engine (dynamic import to pick up env vars)
  const { loadConfig } = await import('../src/server/config.js');
  const { AlanEngine } = await import('../src/server/engine.js');
  const { Hono } = await import('hono');
  const { serve } = await import('@hono/node-server');
  const { healthRoutes } = await import('../src/server/routes/health.js');
  const { anthropicRoutes } = await import('../src/server/routes/anthropic.js');
  const { debugRoutes } = await import('../src/server/routes/debug.js');
  const { adminRoutes } = await import('../src/server/routes/admin.js');

  const config = loadConfig();
  const engine = new AlanEngine(config);

  const publicApp = new Hono();
  publicApp.route('/', healthRoutes(config));
  publicApp.route('/', anthropicRoutes(engine));

  const internalApp = new Hono();
  internalApp.route('/', debugRoutes(engine));
  internalApp.route('/', adminRoutes(engine));

  const internalPort = config.port + 1;

  serve({ fetch: publicApp.fetch, hostname: '0.0.0.0', port: config.port }, () => {
    console.log(`[alan] public server on 0.0.0.0:${config.port}`);
    console.log(`[alan] Send messages: POST http://localhost:${config.port}/v1/messages`);
  });

  serve({ fetch: internalApp.fetch, hostname: '127.0.0.1', port: internalPort }, () => {
    console.log(`[alan] internal server on 127.0.0.1:${internalPort}`);
    console.log('[alan] Ready for testing!');
  });
}

main().catch(err => {
  console.error('[launch] Fatal:', err);
  process.exit(1);
});
