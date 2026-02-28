import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { AlanEngine } from './engine.js';
import { healthRoutes } from './routes/health.js';
import { anthropicRoutes } from './routes/anthropic.js';
import { debugRoutes } from './routes/debug.js';
import { adminRoutes } from './routes/admin.js';

const config = loadConfig();
const engine = new AlanEngine(config);

// Public app — binds 0.0.0.0
const publicApp = new Hono();
publicApp.route('/', healthRoutes(config));
publicApp.route('/', anthropicRoutes(engine));

// Internal app — binds 127.0.0.1 (debug + admin)
const internalApp = new Hono();
internalApp.route('/', debugRoutes(engine));
internalApp.route('/', adminRoutes(engine));

const internalPort = config.port + 1;

serve({ fetch: publicApp.fetch, hostname: '0.0.0.0', port: config.port }, () => {
  console.log(`[alan] public server listening on 0.0.0.0:${config.port}`);
});

serve({ fetch: internalApp.fetch, hostname: '127.0.0.1', port: internalPort }, () => {
  console.log(`[alan] internal server listening on 127.0.0.1:${internalPort}`);
});
