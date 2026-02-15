/**
 * Metroid HTTP Adapter — REST API for OpenClaw bot integration.
 *
 * Endpoints:
 *   GET  /agents                    — list all agents
 *   POST /agents                    — create agent { name, card, mode? }
 *   GET  /agents/:id                — get agent details
 *   POST /agents/:id/mode           — switch mode { mode: 'classic'|'enhanced' }
 *   POST /agents/:id/chat           — send message { content, userId?, userName?, history? }
 *   GET  /agents/:id/emotion        — get emotion state
 *   GET  /agents/:id/memories       — get recent memories ?limit=10
 *   GET  /agents/:id/growth         — get active behavioral changes
 *   GET  /world/search?q=keyword    — search world entries
 *   POST /import/world              — import world book { path, charName?, userName? }
 *   GET  /health                    — health check
 *
 * Usage:
 *   ANTHROPIC_API_KEY=xxx npx tsx src/adapter/http.ts [--port 8100]
 *
 * From OpenClaw bot (via exec tool):
 *   curl -s http://127.0.0.1:8100/agents/AGENT_ID/chat \
 *     -H 'Content-Type: application/json' \
 *     -d '{"content":"Hello!","userId":"user-1","userName":"用户"}'
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { resolve } from 'path';
import { Metroid } from '../index.js';
import type { MetroidMessage, AgentMode } from '../types.js';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') ?? '8100');
const DATA_DIR = process.env.METROID_DATA_DIR || resolve(process.cwd(), 'data');

// === JSON helpers ===

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
}

// === Route matching ===

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; }) + '$'
  );
  routes.push({ method, pattern, keys, handler });
}

function matchRoute(method: string, url: string): { handler: Handler; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = url.match(r.pattern);
    if (!match) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => { params[key] = match[i + 1]; });
    return { handler: r.handler, params };
  }
  return null;
}

// === Initialize Metroid ===

let metroid: Metroid;
let msgCounter = 0;

function init() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[Metroid Adapter] ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  metroid = new Metroid({
    dataDir: DATA_DIR,
    dbPath: resolve(DATA_DIR, 'metroid.db'),
    llm: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      mainModel: process.env.METROID_MODEL || 'claude-opus-4-6',
      lightModel: process.env.METROID_LIGHT_MODEL || 'claude-haiku-4-5-20251001',
      maxContextTokens: 200_000,
    },
  });

  // Start all existing agents
  for (const agent of metroid.getAllAgents()) {
    metroid.start(agent.id);
  }
}

// === Routes ===

route('GET', '/health', (_req, res) => {
  const agents = metroid.getAllAgents();
  json(res, { status: 'ok', agents: agents.length, uptime: process.uptime() });
});

route('GET', '/agents', (_req, res) => {
  const agents = metroid.getAllAgents().map(a => ({
    id: a.id, name: a.name, mode: a.mode,
    emotion: a.emotionState,
    createdAt: a.createdAt.toISOString(),
  }));
  json(res, { agents });
});

route('POST', '/agents', async (req, res) => {
  const body = await readBody(req);
  if (!body.name || !body.card) return error(res, 'name and card required');
  const agent = metroid.createAgent(body.name, body.card, body.mode || 'classic');
  metroid.start(agent.id);
  json(res, { agent: { id: agent.id, name: agent.name, mode: agent.mode } }, 201);
});

route('GET', '/agents/:id', (_req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  json(res, {
    id: agent.id, name: agent.name, mode: agent.mode,
    emotion: agent.emotionState,
    card: { name: agent.card.name, personality: agent.card.personality },
    createdAt: agent.createdAt.toISOString(),
  });
});

route('POST', '/agents/:id/mode', async (req, res, { id }) => {
  const body = await readBody(req);
  if (!['classic', 'enhanced'].includes(body.mode)) return error(res, 'mode must be classic or enhanced');
  metroid.setAgentMode(id, body.mode as AgentMode);
  json(res, { ok: true, mode: body.mode });
});

route('POST', '/agents/:id/chat', async (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);

  const body = await readBody(req);
  if (!body.content) return error(res, 'content required');

  const userMsg: MetroidMessage = {
    id: `msg-${++msgCounter}-${Date.now()}`,
    channel: body.channel || 'web-im',
    author: {
      id: body.userId || 'user-api',
      name: body.userName || '用户',
      isBot: false,
    },
    content: body.content,
    timestamp: Date.now(),
  };

  // Build history from provided messages
  const history: MetroidMessage[] = (body.history || []).map((h: any, i: number) => ({
    id: `hist-${i}`,
    channel: body.channel || 'web-im',
    author: {
      id: h.isBot ? agent.id : (body.userId || 'user-api'),
      name: h.isBot ? agent.name : (body.userName || '用户'),
      isBot: !!h.isBot,
    },
    content: h.content,
    timestamp: Date.now() - (body.history.length - i) * 1000,
  }));

  try {
    const response = await metroid.chat(id, userMsg, history);
    const emotion = metroid.getEmotionState(id);
    const growthCount = metroid.getActiveGrowthChanges(id).length;

    json(res, {
      response,
      emotion,
      mode: agent.mode,
      growthChanges: growthCount,
    });
  } catch (err: any) {
    error(res, `chat failed: ${err.message}`, 500);
  }
});

route('GET', '/agents/:id/emotion', (_req, res, { id }) => {
  const emotion = metroid.getEmotionState(id);
  if (!emotion) return error(res, 'agent not found', 404);
  json(res, { emotion });
});

route('GET', '/agents/:id/memories', (req, res, { id }) => {
  const url = new URL(req.url!, `http://localhost`);
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const memories = metroid.getRecentMemories(id, limit);
  json(res, {
    memories: memories.map(m => ({
      id: m.id, type: m.type,
      content: m.summary || m.content.slice(0, 200),
      importance: m.importance, confidence: m.confidence,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

route('GET', '/agents/:id/growth', (_req, res, { id }) => {
  const changes = metroid.getActiveGrowthChanges(id);
  json(res, {
    changes: changes.map(c => ({
      id: c.id, observation: c.observation, adaptation: c.adaptation,
      confidence: c.confidence, createdAt: c.createdAt.toISOString(),
    })),
  });
});

route('GET', '/world/search', (req, res) => {
  const url = new URL(req.url!, `http://localhost`);
  const q = url.searchParams.get('q');
  if (!q) return error(res, 'q parameter required');
  const results = metroid.searchWorldEntries(q);
  json(res, { results });
});

route('POST', '/import/world', async (req, res) => {
  const body = await readBody(req);
  if (!body.path) return error(res, 'path required');
  try {
    // Dynamic import to avoid top-level dependency on getDb
    const { importSTWorldInfo } = await import('../importers/st-world.js');
    const { getDb } = await import('../db/index.js');
    const db = getDb({ dataDir: DATA_DIR, dbPath: resolve(DATA_DIR, 'metroid.db') } as any);
    const result = importSTWorldInfo(body.path, db, body.charName, body.userName);
    json(res, { imported: result.entriesImported, skipped: result.entriesSkipped });
  } catch (err: any) {
    error(res, `import failed: ${err.message}`, 500);
  }
});

// === Server ===

init();

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const method = req.method || 'GET';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const matched = matchRoute(method, url);
  if (matched) {
    try {
      await matched.handler(req, res, matched.params);
    } catch (err: any) {
      console.error(`[Metroid] ${method} ${url} error:`, err.message);
      error(res, 'internal error', 500);
    }
  } else {
    error(res, 'not found', 404);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const agents = metroid.getAllAgents();
  console.log(`[Metroid Adapter] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Metroid Adapter] Data: ${DATA_DIR}`);
  console.log(`[Metroid Adapter] Agents: ${agents.length}`);
  agents.forEach(a => console.log(`  - ${a.name} (${a.id}) [${a.mode}]`));
});
