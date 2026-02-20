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
 *   GET  /agents/:id/proactive/pending — get pending proactive messages
 *   POST /agents/:id/proactive/deliver — mark proactive message as delivered { messageId }
 *   POST /agents/:id/proactive/fire    — fire event trigger { event }
 *   GET  /agents/:id/impulse          — get impulse accumulator state (debug)
 *   POST /debug/clock/advance          — advance debug clock { minutes }
 *   POST /debug/clock/reset            — reset debug clock to real time
 *   GET  /debug/clock                  — get current clock offset
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
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { readFileSync, mkdirSync, appendFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { Metroid, ChatResult } from '../index.js';
import type { MetroidMessage, AgentMode, ProactiveMessage } from '../types.js';
import type { Socket } from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') ?? '8100');
const DATA_DIR = process.env.METROID_DATA_DIR || resolve(process.cwd(), 'data');
const LOG_DIR = resolve(DATA_DIR, 'logs');

// Ensure log directory exists
mkdirSync(LOG_DIR, { recursive: true });

// === WebSocket (RFC 6455) — hand-rolled, zero deps ===

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB9FC11';

interface WSClient {
  socket: Socket;
  agentId?: string;
  userId?: string;
  userName?: string;
  alive: boolean;
}

const wsClients = new Set<WSClient>();

/** Compute Sec-WebSocket-Accept header */
function wsAcceptKey(key: string): string {
  return createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

/** Encode a text frame (RFC 6455 §5.2) */
function wsEncodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf-8');
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Send JSON to a WS client */
function wsSend(client: WSClient, data: Record<string, unknown>): void {
  if (!client.socket.writable) return;
  try {
    client.socket.write(wsEncodeFrame(JSON.stringify(data)));
  } catch { /* ignore write errors on dead sockets */ }
}

/** Broadcast JSON to all clients subscribed to an agent */
function wsBroadcast(agentId: string, data: Record<string, unknown>): void {
  for (const c of wsClients) {
    if (c.agentId === agentId) wsSend(c, data);
  }
}

/** Send a close frame and destroy */
function wsClose(client: WSClient, code = 1000): void {
  try {
    const buf = Buffer.alloc(4);
    buf[0] = 0x88; // FIN + close opcode
    buf[1] = 2;
    buf.writeUInt16BE(code, 2);
    client.socket.write(buf);
  } catch { /* ignore */ }
  client.socket.destroy();
  wsClients.delete(client);
}

/** Decode incoming WS frames (handles fragmentation + masking) */
function wsHandleData(client: WSClient, buf: Buffer): Array<{ opcode: number; payload: Buffer }> {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;
  while (offset < buf.length) {
    if (buf.length - offset < 2) break;
    const byte0 = buf[offset];
    const byte1 = buf[offset + 1];
    const opcode = byte0 & 0x0f;
    const masked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;
    offset += 2;

    if (payloadLen === 126) {
      if (buf.length - offset < 2) break;
      payloadLen = buf.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (buf.length - offset < 8) break;
      payloadLen = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length - offset < 4) break;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length - offset < payloadLen) break;
    const payload = buf.subarray(offset, offset + payloadLen);
    offset += payloadLen;

    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }
    frames.push({ opcode, payload });
  }
  return frames;
}

/** Handle a single decoded WS message */
async function wsHandleMessage(client: WSClient, text: string): Promise<void> {
  let msg: any;
  try { msg = JSON.parse(text); } catch { return; }

  if (msg.type === 'ping') {
    wsSend(client, { type: 'pong' });
    return;
  }

  if (msg.type === 'subscribe') {
    const agent = metroid.getAgent(msg.agentId);
    if (!agent) { wsSend(client, { type: 'error', message: 'agent not found' }); return; }
    client.agentId = msg.agentId;
    client.userId = msg.userId || 'ws-user';
    client.userName = msg.userName || '用户';
    wsSend(client, { type: 'subscribed', agentId: agent.id, agentName: agent.name, mode: agent.mode });
    // Send current state
    const emotion = metroid.getEmotionState(agent.id);
    const growth = metroid.getActiveGrowthChanges(agent.id);
    const memories = metroid.getRecentMemories(agent.id, 8);
    const impulse = metroid.getImpulseState(agent.id);
    wsSend(client, {
      type: 'state_sync', emotion,
      growth: growth.map(c => ({ adaptation: c.adaptation, confidence: c.confidence, observation: c.observation })),
      memories: memories.map(m => ({ type: m.type, content: (m.summary || m.content).slice(0, 80) })),
      impulse: impulse ? { value: impulse.value, activeEvents: impulse.activeEvents, suppressionCount: impulse.suppressionCount } : null,
    });
    return;
  }

  if (msg.type === 'chat') {
    if (!client.agentId) { wsSend(client, { type: 'error', message: 'subscribe to an agent first' }); return; }
    const agent = metroid.getAgent(client.agentId);
    if (!agent) { wsSend(client, { type: 'error', message: 'agent not found' }); return; }

    const userMsg: MetroidMessage = {
      id: `ws-${++msgCounter}-${Date.now()}`,
      channel: 'web-im',
      author: { id: client.userId || 'ws-user', name: client.userName || '用户', isBot: false },
      content: msg.content,
      timestamp: Date.now(),
    };

    const history: MetroidMessage[] = (msg.history || []).map((h: any, i: number) => ({
      id: `ws-hist-${i}`,
      channel: 'web-im' as const,
      author: {
        id: h.isBot ? agent.id : (client.userId || 'ws-user'),
        name: h.isBot ? agent.name : (client.userName || '用户'),
        isBot: !!h.isBot,
      },
      content: h.content,
      timestamp: Date.now() - ((msg.history?.length || 0) - i) * 1000,
    }));

    try {
      const result = await metroid.chat(client.agentId, userMsg, history);
      const emotion = metroid.getEmotionState(client.agentId);
      const growthChanges = metroid.getActiveGrowthChanges(client.agentId);

      logConversation(client.agentId, agent.name, {
        agentId: client.agentId, agentName: agent.name, mode: agent.mode, via: 'websocket',
        user: { id: client.userId, name: client.userName, content: msg.content },
        response: result.response, emotion,
        growthChanges: growthChanges.map(c => ({ adaptation: c.adaptation, confidence: c.confidence })),
        timing: result.timing,
      });

      const impulse = metroid.getImpulseState(client.agentId);
      wsSend(client, {
        type: 'chat_response', response: result.response, emotion, mode: agent.mode,
        growthChanges: growthChanges.length,
        memories: metroid.getRecentMemories(client.agentId, 8).map(m => ({ type: m.type, content: (m.summary || m.content).slice(0, 80) })),
        growth: growthChanges.map(c => ({ adaptation: c.adaptation, confidence: c.confidence, observation: c.observation })),
        timing: result.timing,
        tokenUsage: result.tokenUsage,
        fragmentSummary: result.fragmentSummary,
        impulse: impulse ? { value: impulse.value, activeEvents: impulse.activeEvents, suppressionCount: impulse.suppressionCount } : null,
      });
    } catch (err: any) {
      wsSend(client, { type: 'error', message: `chat failed: ${err.message}` });
    }
    return;
  }
}

/** Perform WebSocket handshake and set up frame handling */
function wsUpgrade(req: IncomingMessage, socket: Socket): void {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n\r\n`
  );

  const client: WSClient = { socket, alive: true };
  wsClients.add(client);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  socket.on('data', (buf: Buffer) => {
    const frames = wsHandleData(client, buf);
    for (const frame of frames) {
      if (frame.opcode === 0x08) { // close
        wsClose(client);
        return;
      }
      if (frame.opcode === 0x09) { // ping → pong
        const pong = Buffer.alloc(2 + frame.payload.length);
        pong[0] = 0x8a; // FIN + pong
        pong[1] = frame.payload.length;
        frame.payload.copy(pong, 2);
        socket.write(pong);
        continue;
      }
      if (frame.opcode === 0x01) { // text
        const text = frame.payload.toString('utf-8');
        wsHandleMessage(client, text).catch(err =>
          console.error('[WS] message handler error:', err.message || err)
        );
      }
    }
  });

  socket.on('close', () => {
    wsClients.delete(client);
    console.log(`[WS] Client disconnected (${wsClients.size} total)`);
  });

  socket.on('error', () => {
    wsClients.delete(client);
  });
}

// Heartbeat: ping all clients every 30s, drop dead ones
setInterval(() => {
  for (const client of wsClients) {
    if (!client.alive) { wsClose(client); continue; }
    client.alive = false;
    try {
      const ping = Buffer.alloc(2);
      ping[0] = 0x89; // FIN + ping
      ping[1] = 0;
      client.socket.write(ping);
    } catch { wsClients.delete(client); }
  }
}, 30_000);

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
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_BASE_URL) {
    console.error('[Metroid Adapter] ANTHROPIC_API_KEY or OPENAI_BASE_URL required');
    process.exit(1);
  }

  metroid = new Metroid({
    dataDir: DATA_DIR,
    dbPath: resolve(DATA_DIR, 'metroid.db'),
    llm: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      mainModel: process.env.METROID_MODEL || 'claude-opus-4-6',
      lightModel: process.env.METROID_LIGHT_MODEL || 'claude-haiku-4-5-20251001',
      maxContextTokens: 200_000,
      openaiBaseUrl: process.env.OPENAI_BASE_URL,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL,
      openaiModelFallback: process.env.OPENAI_MODEL_FALLBACK,
    },
  });

  // Start all existing agents
  for (const agent of metroid.getAllAgents()) {
    metroid.start(agent.id);
  }

  // Push proactive messages to WS clients
  metroid.onProactiveMessage((agentId: string, msg: ProactiveMessage) => {
    console.log(`[WS] Pushing proactive message to agent ${agentId}: ${msg.content.slice(0, 50)}...`);
    wsBroadcast(agentId, {
      type: 'proactive',
      message: { id: msg.id, triggerType: msg.triggerType, content: msg.content, createdAt: msg.createdAt.toISOString() },
    });
    // Auto-mark as delivered for WS clients
    if ([...wsClients].some(c => c.agentId === agentId)) {
      metroid.markProactiveDelivered(msg.id);
    }
  });
}

// === Conversation Logging ===

function logConversation(agentId: string, agentName: string, entry: any) {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logFile = resolve(LOG_DIR, `${agentName}-${date}.jsonl`);
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
  appendFileSync(logFile, line + '\n');
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
    const result = await metroid.chat(id, userMsg, history);
    const emotion = metroid.getEmotionState(id);
    const growthCount = metroid.getActiveGrowthChanges(id).length;
    const growthChanges = metroid.getActiveGrowthChanges(id);

    // Log conversation
    logConversation(id, agent.name, {
      agentId: id, agentName: agent.name, mode: agent.mode,
      user: { id: body.userId, name: body.userName, content: body.content },
      response: result.response,
      emotion,
      growthChanges: growthChanges.map(c => ({ adaptation: c.adaptation, confidence: c.confidence })),
      timing: result.timing,
    });

    json(res, {
      response: result.response,
      emotion,
      mode: agent.mode,
      growthChanges: growthCount,
      timing: result.timing,
      tokenUsage: result.tokenUsage,
      fragmentSummary: result.fragmentSummary,
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

// === Proactive Engine endpoints ===

route('GET', '/agents/:id/proactive/pending', (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const url = new URL(req.url!, `http://localhost`);
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const messages = metroid.getPendingProactiveMessages(id, limit);
  json(res, {
    messages: messages.map(m => ({
      id: m.id, triggerType: m.triggerType, triggerId: m.triggerId,
      content: m.content, createdAt: m.createdAt.toISOString(),
    })),
  });
});

route('POST', '/agents/:id/proactive/deliver', async (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const body = await readBody(req);
  if (!body.messageId) return error(res, 'messageId required');
  metroid.markProactiveDelivered(body.messageId);
  json(res, { ok: true });
});

route('POST', '/agents/:id/proactive/fire', async (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const body = await readBody(req);
  if (!body.event) return error(res, 'event name required');
  try {
    const msg = await metroid.fireProactiveEvent(id, body.event);
    if (!msg) return error(res, 'no matching event trigger found', 404);
    json(res, {
      message: {
        id: msg.id, triggerType: msg.triggerType,
        content: msg.content, createdAt: msg.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    error(res, `proactive fire failed: ${err.message}`, 500);
  }
});

route('GET', '/agents/:id/impulse', (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const state = metroid.getImpulseState(id);
  if (!state) return json(res, { enabled: false, message: 'impulse not active for this agent' });
  json(res, {
    enabled: true,
    impulse: state.value,
    activeEvents: state.activeEvents,
    suppressionCount: state.suppressionCount,
    lastFireTime: state.lastFireTime ? new Date(state.lastFireTime).toISOString() : null,
  });
});

// === Debug Clock endpoints ===

route('POST', '/debug/clock/advance', async (req, res) => {
  const body = await readBody(req);
  const minutes = body.minutes ?? 60;
  metroid.advanceTime(minutes);
  json(res, { ok: true, advancedMinutes: minutes, totalOffsetMinutes: metroid.getTimeOffset() });
});

route('POST', '/debug/clock/reset', (_req, res) => {
  metroid.resetClock();
  json(res, { ok: true, totalOffsetMinutes: 0 });
});

route('GET', '/debug/clock', (_req, res) => {
  json(res, { offsetMinutes: metroid.getTimeOffset() });
});

route('POST', '/debug/tick/:id', async (_req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  await metroid.debugTick(id);
  const impulse = metroid.getImpulseState(id);
  json(res, {
    ok: true,
    impulse: impulse ? { value: impulse.value, events: impulse.activeEvents.length, suppressions: impulse.suppressionCount } : null,
    clockOffset: metroid.getTimeOffset(),
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

// === Debug Console API ===

route('GET', '/agents/:id/config', (_req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const llm = metroid.getLLMConfig();
  json(res, {
    agent: { id: agent.id, name: agent.name, mode: agent.mode, rpMode: agent.card.rpMode || 'off' },
    llm,
    emotion: agent.card.emotion || {},
    growth: agent.card.growth || {},
    proactive: { enabled: !!agent.card.proactive?.enabled, triggers: (agent.card.proactive?.triggers || []).length },
  });
});

route('POST', '/agents/:id/config', async (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const body = await readBody(req);
  const applied: Record<string, unknown> = {};
  if (body.openaiModel !== undefined) { metroid.updateLLMConfig({ openaiModel: body.openaiModel }); applied.openaiModel = body.openaiModel; }
  if (body.openaiModelFallback !== undefined) { metroid.updateLLMConfig({ openaiModelFallback: body.openaiModelFallback }); applied.openaiModelFallback = body.openaiModelFallback; }
  if (body.rpMode && ['off', 'sfw', 'nsfw'].includes(body.rpMode)) { metroid.setRpMode(id, body.rpMode); applied.rpMode = body.rpMode; }
  if (body.mode && ['classic', 'enhanced'].includes(body.mode)) { metroid.setAgentMode(id, body.mode); applied.mode = body.mode; }
  json(res, { ok: true, applied });
});

route('GET', '/agents/:id/prompt-inspect', async (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const url = new URL(req.url!, `http://localhost`);
  const text = url.searchParams.get('text') || undefined;
  try {
    const result = await metroid.inspectPrompt(id, text);
    json(res, {
      basePrompt: result.basePrompt,
      fragments: result.fragments.map(f => ({
        source: f.source, priority: f.priority, tokens: f.tokens,
        required: f.required, content: f.content.slice(0, 2000),
        position: f.position,
      })),
      compiledPrompt: result.compiledPrompt.slice(0, 8000),
      mode: result.mode,
      tokenBudget: result.tokenBudget,
      tokensUsed: result.tokensUsed,
    });
  } catch (err: any) {
    error(res, `inspect failed: ${err.message}`, 500);
  }
});

route('GET', '/agents/:id/growth/all', (req, res, { id }) => {
  const agent = metroid.getAgent(id);
  if (!agent) return error(res, 'agent not found', 404);
  const url = new URL(req.url!, `http://localhost`);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const changes = metroid.getAllGrowthChanges(id, limit);
  json(res, {
    changes: changes.map(c => ({
      id: c.id, observation: c.observation, adaptation: c.adaptation,
      confidence: c.confidence, active: c.active,
      createdAt: c.createdAt.toISOString(),
      revertedAt: c.revertedAt?.toISOString(),
    })),
  });
});

route('GET', '/debug/config', (_req, res) => {
  const llm = metroid.getLLMConfig();
  json(res, { llm });
});

// === Server ===

init();

// Serve web UI and logs
function serveStatic(res: ServerResponse, filePath: string, contentType: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    error(res, 'not found', 404);
  }
}

// Log listing route
route('GET', '/logs', (_req, res) => {
  if (!existsSync(LOG_DIR)) { json(res, { files: [] }); return; }
  const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
  json(res, { files, dir: LOG_DIR });
});

route('GET', '/logs/:filename', (_req, res, { filename }) => {
  const filePath = resolve(LOG_DIR, filename);
  if (!existsSync(filePath) || !filename.endsWith('.jsonl')) return error(res, 'not found', 404);
  const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  json(res, { entries });
});

const server = createServer(async (req, res) => {
  const rawUrl = req.url || '/';
  const url = rawUrl.split('?')[0];
  const method = req.method || 'GET';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve web UI at root
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    serveStatic(res, resolve(__dirname, '../../public/index.html'), 'text/html; charset=utf-8');
    return;
  }

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
  console.log(`[Metroid Adapter] WebSocket: ws://127.0.0.1:${PORT}`);
  console.log(`[Metroid Adapter] Data: ${DATA_DIR}`);
  console.log(`[Metroid Adapter] Agents: ${agents.length}`);
  agents.forEach(a => console.log(`  - ${a.name} (${a.id}) [${a.mode}]`));
});

// WebSocket upgrade
server.on('upgrade', (req, socket, _head) => {
  wsUpgrade(req, socket as Socket);
});
