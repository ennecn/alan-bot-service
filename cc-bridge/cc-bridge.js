#!/usr/bin/env node
/**
 * Claude Code Bridge - HTTP service for persistent Claude Code sessions
 *
 * Runs on Mac Mini host, manages Claude Code subprocesses.
 * Bots in Docker containers call this via host.docker.internal:9090
 *
 * API:
 *   POST /api/chat          - Send message to Claude Code (SSE streaming response)
 *   GET  /api/sessions       - List all sessions
 *   GET  /api/sessions/:id   - Get session details
 *   POST /api/sessions/:id/kill - Kill active process for a session
 */

import { spawn } from 'child_process';
import http from 'http';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

const PORT = 9090;
const CLAUDE_BIN = '/opt/homebrew/bin/claude';
const DEFAULT_WORKING_DIR = '/Users/fangjin';

// ============================================================
// Session Manager
// ============================================================
class SessionManager {
  constructor() {
    // name -> { name, uuid, workingDir, createdAt, lastActivity, messageCount, activeProcess, history }
    this.sessions = new Map();
  }

  getOrCreate(name, workingDir) {
    if (!this.sessions.has(name)) {
      const uuid = randomUUID();
      this.sessions.set(name, {
        name,
        uuid,  // Claude Code uses this UUID for --resume
        workingDir: workingDir || DEFAULT_WORKING_DIR,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        messageCount: 0,
        activeProcess: null,
        history: [],
      });
      log(`Session created: ${name} -> ${uuid} (dir: ${workingDir || DEFAULT_WORKING_DIR})`);
    }
    return this.sessions.get(name);
  }

  get(name) {
    return this.sessions.get(name);
  }

  list() {
    return Array.from(this.sessions.values()).map(s => ({
      name: s.name,
      uuid: s.uuid,
      workingDir: s.workingDir,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messageCount,
      active: !!s.activeProcess,
      historyLength: s.history.length,
    }));
  }

  killProcess(name) {
    const session = this.sessions.get(name);
    if (session?.activeProcess) {
      session.activeProcess.kill('SIGTERM');
      session.activeProcess = null;
      return true;
    }
    return false;
  }
}

const sessions = new SessionManager();

// ============================================================
// Logging
// ============================================================
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ============================================================
// Execute Claude Code
// ============================================================
function runClaudeCode(session, message, options = {}) {
  const {
    model,
    maxBudget,
    allowedTools,
    systemPrompt,
    permissionMode = 'bypassPermissions',
  } = options;

  const isFirstMessage = session.messageCount === 0;
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
  ];

  // First message: use --session-id to create; subsequent: --resume to continue
  if (isFirstMessage) {
    args.push('--session-id', session.uuid);
  } else {
    args.push('--resume', session.uuid);
  }

  if (model) {
    args.push('--model', model);
  }

  if (maxBudget) {
    args.push('--max-budget-usd', String(maxBudget));
  }

  if (allowedTools) {
    args.push('--allowedTools', ...allowedTools);
  }

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  // The prompt message
  args.push('--', message);

  log(`Exec: claude ${args.slice(0, 8).join(' ')} ... (session=${session.name}, uuid=${session.uuid.slice(0, 8)})`);

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: session.workingDir,
    env: {
      ...process.env,
      HOME: '/Users/fangjin',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  session.activeProcess = proc;
  session.messageCount++;
  session.lastActivity = new Date().toISOString();

  return proc;
}

// ============================================================
// HTTP Request Handling
// ============================================================
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

// ============================================================
// Route: POST /api/chat
// ============================================================
async function handleChat(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return sendError(res, 400, 'Invalid JSON body');
  }

  const {
    session_id,
    message,
    working_directory,
    model,
    max_budget_usd,
    allowed_tools,
    system_prompt,
  } = body;

  if (!message) {
    return sendError(res, 400, 'message is required');
  }

  const sid = session_id || randomUUID();
  const session = sessions.getOrCreate(sid, working_directory);

  // Update working dir if provided and different
  if (working_directory && working_directory !== session.workingDir) {
    session.workingDir = working_directory;
  }

  // Check if there's already an active process
  if (session.activeProcess) {
    return sendError(res, 409, `Session ${sid} has an active process. Kill it first or wait.`);
  }

  // Start Claude Code
  const proc = runClaudeCode(session, message, {
    model,
    maxBudget: max_budget_usd,
    allowedTools: allowed_tools,
    systemPrompt: system_prompt,
  });

  // Set up SSE streaming response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-ID': sid,
  });

  // Send session info
  res.write(`event: session\ndata: ${JSON.stringify({ session_id: sid, uuid: session.uuid, working_directory: session.workingDir })}\n\n`);

  let fullText = '';
  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);

        // Forward Claude Code's stream-json events
        res.write(`event: claude\ndata: ${trimmed}\n\n`);

        // Extract text for history
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              fullText += block.text;
            }
          }
        }

        // Handle result event
        if (event.type === 'result') {
          fullText = event.result || fullText;
        }
      } catch {
        // Non-JSON line, forward as log
        res.write(`event: log\ndata: ${JSON.stringify({ text: trimmed })}\n\n`);
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      res.write(`event: error\ndata: ${JSON.stringify({ text })}\n\n`);
    }
  });

  proc.on('close', (code) => {
    session.activeProcess = null;
    session.lastActivity = new Date().toISOString();

    // Save to history
    session.history.push({
      timestamp: new Date().toISOString(),
      message: message.slice(0, 200),
      responsePreview: fullText.slice(0, 500),
      exitCode: code,
    });

    // Keep history manageable
    if (session.history.length > 50) {
      session.history = session.history.slice(-50);
    }

    res.write(`event: done\ndata: ${JSON.stringify({ exit_code: code, session_id: sid })}\n\n`);
    res.end();

    log(`Session ${sid} completed (exit=${code}, text=${fullText.length} chars)`);
  });

  proc.on('error', (err) => {
    session.activeProcess = null;
    res.write(`event: error\ndata: ${JSON.stringify({ text: err.message })}\n\n`);
    res.end();
    log(`Session ${sid} error: ${err.message}`);
  });

  // Handle client disconnect
  req.on('close', () => {
    if (session.activeProcess) {
      log(`Client disconnected, keeping Claude Code process alive for session ${sid}`);
      // Don't kill - let it finish
    }
  });
}

// ============================================================
// Router
// ============================================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // POST /api/chat
    if (req.method === 'POST' && pathname === '/api/chat') {
      return await handleChat(req, res);
    }

    // GET /api/sessions
    if (req.method === 'GET' && pathname === '/api/sessions') {
      return sendJSON(res, 200, sessions.list());
    }

    // GET /api/sessions/:id
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      if (!session) return sendError(res, 404, 'Session not found');
      return sendJSON(res, 200, {
        name: session.name,
        uuid: session.uuid,
        workingDir: session.workingDir,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messageCount,
        active: !!session.activeProcess,
        history: session.history,
      });
    }

    // POST /api/sessions/:id/kill
    const killMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/kill$/);
    if (req.method === 'POST' && killMatch) {
      const killed = sessions.killProcess(killMatch[1]);
      return sendJSON(res, 200, { killed });
    }

    // GET /health
    if (req.method === 'GET' && pathname === '/health') {
      return sendJSON(res, 200, {
        status: 'ok',
        service: 'cc-bridge',
        sessions: sessions.list().length,
        activeSessions: sessions.list().filter(s => s.active).length,
      });
    }

    // 404
    sendError(res, 404, 'Not found');
  } catch (e) {
    log(`Error: ${e.message}`);
    sendError(res, 500, e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Claude Code Bridge listening on http://0.0.0.0:${PORT}`);
  log(`Claude binary: ${CLAUDE_BIN}`);
  log(`Default workdir: ${DEFAULT_WORKING_DIR}`);
});
