import http from 'http';
import https from 'https';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const CONFIG_PATH = join(__dirname, 'config.json');
const STATS_PATH = join(__dirname, 'stats.json');
const OPENCLAW_CONFIG_PATH = '/home/node/.openclaw/openclaw.json';

// ============================================================
// Config
// ============================================================

let config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================
// Logging
// ============================================================

function ts() { return new Date().toISOString(); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

// ============================================================
// Token Usage Statistics
// ============================================================

let tokenStats = {};
try { tokenStats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8')); } catch {}

let statsDirty = false;

function recordUsage(botName, providerName, model, inputTokens, outputTokens) {
  if (!inputTokens && !outputTokens) return;
  if (!tokenStats[botName]) {
    tokenStats[botName] = {
      totalInput: 0, totalOutput: 0, requests: 0,
      byModel: {}, byProvider: {},
    };
  }
  const s = tokenStats[botName];
  s.totalInput += inputTokens;
  s.totalOutput += outputTokens;
  s.requests += 1;
  s.lastUsed = new Date().toISOString();

  if (!s.byModel[model]) s.byModel[model] = { input: 0, output: 0, count: 0 };
  s.byModel[model].input += inputTokens;
  s.byModel[model].output += outputTokens;
  s.byModel[model].count += 1;

  if (!s.byProvider[providerName]) s.byProvider[providerName] = { input: 0, output: 0, count: 0 };
  s.byProvider[providerName].input += inputTokens;
  s.byProvider[providerName].output += outputTokens;
  s.byProvider[providerName].count += 1;

  statsDirty = true;
  log(`[${botName}] tokens: in=${inputTokens} out=${outputTokens} (cumulative: in=${s.totalInput} out=${s.totalOutput})`);
}

function saveStats() {
  if (!statsDirty) return;
  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(tokenStats, null, 2));
    statsDirty = false;
  } catch (e) {
    log(`[Stats] Save error: ${e.message}`);
  }
}

setInterval(saveStats, 30_000);

// ============================================================
// Docker Exec Helpers — read/write openclaw.json in containers
// ============================================================

function dockerExec(container, cmd) {
  try {
    return execSync(`docker exec ${container} sh -c "${cmd}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch (e) {
    log(`[Docker] exec error on ${container}: ${e.message.split('\n')[0]}`);
    return null;
  }
}

function readOpenClawConfig(container) {
  const out = dockerExec(container, `cat ${OPENCLAW_CONFIG_PATH}`);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

function writeOpenClawConfig(container, ocConfig) {
  const json = JSON.stringify(ocConfig, null, 2);
  const b64 = Buffer.from(json).toString('base64');
  const result = dockerExec(container, `echo ${b64} | base64 -d > ${OPENCLAW_CONFIG_PATH}`);
  return result !== null;
}

function getCurrentModel(container) {
  const conf = readOpenClawConfig(container);
  if (!conf) return null;
  return conf?.agents?.defaults?.model?.primary || null;
}

function setCurrentModel(container, modelId) {
  const conf = readOpenClawConfig(container);
  if (!conf) return false;
  if (!conf.agents) conf.agents = {};
  if (!conf.agents.defaults) conf.agents.defaults = {};
  if (!conf.agents.defaults.model) conf.agents.defaults.model = {};
  conf.agents.defaults.model.primary = modelId;
  return writeOpenClawConfig(container, conf);
}

// ============================================================
// Telegram Notification
// ============================================================

function sendTelegram(text) {
  const tg = config.telegram;
  if (!tg || !tg.botToken || !tg.chatId) {
    log('[Telegram] Not configured, skipping');
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: tg.chatId,
      text,
      parse_mode: 'HTML',
    });
    const req = https.request('https://api.telegram.org/bot' + tg.botToken + '/sendMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (resp) => {
      let body = '';
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => {
        if (resp.statusCode === 200) {
          log('[Telegram] Status notification sent');
          resolve(true);
        } else {
          log(`[Telegram] Failed (${resp.statusCode}): ${body.slice(0, 200)}`);
          resolve(false);
        }
      });
    });
    req.on('error', (e) => {
      log(`[Telegram] Error: ${e.message}`);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

function buildStatusMessage(botStatuses) {
  const lines = ['<b>OpenClaw Config Manager</b>', ''];
  const upH = Math.floor(process.uptime() / 3600);
  const upM = Math.floor((process.uptime() % 3600) / 60);
  lines.push(`Uptime: ${upH > 0 ? upH + 'h ' : ''}${upM}m`);
  lines.push('');

  // Model option labels for readability
  const labelMap = {};
  for (const opt of config.modelOptions || []) {
    labelMap[opt.id] = opt.label;
  }

  for (const [botId, botCfg] of Object.entries(config.bots)) {
    const status = botStatuses?.[botId];
    const modelId = status?.model || 'unknown';
    const label = labelMap[modelId] || modelId;
    const ok = status?.ok ? '✅' : '⚠️';
    lines.push(`${ok} <b>${botCfg.name}</b>: <code>${label}</code>`);
  }

  // Token stats summary
  if (Object.keys(tokenStats).length > 0) {
    lines.push('');
    lines.push('<b>Token Usage:</b>');
    for (const [botName, s] of Object.entries(tokenStats)) {
      const inK = (s.totalInput / 1000).toFixed(1);
      const outK = (s.totalOutput / 1000).toFixed(1);
      lines.push(`  ${botName}: ${inK}K in / ${outK}K out (${s.requests} reqs)`);
    }
  }

  lines.push('');
  lines.push(`<i>${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>`);
  return lines.join('\n');
}

// ============================================================
// Gemini Native Tool Call Detection & Parsing
// (Kept for legacy proxy fallback)
// ============================================================

const GEMINI_TC_BEGIN = '<|tool_calls_section_begin|>';
const GEMINI_TC_END = '<|tool_calls_section_end|>';
const GEMINI_DETECT_LEN = 40;

function parseGeminiNativeToolCalls(text) {
  if (!text.includes(GEMINI_TC_BEGIN)) return null;

  const calls = [];
  const callRe = /<\|tool_call_begin\|>([\s\S]*?)<\|tool_call_end\|>/g;
  let m;

  while ((m = callRe.exec(text)) !== null) {
    let raw = m[1].trim();
    for (const pfx of ['default_api:', 'functions:']) {
      if (raw.startsWith(pfx)) { raw = raw.slice(pfx.length); break; }
    }

    let funcName = '';
    let argsStr = '';
    const braceIdx = raw.indexOf('{');
    const nlIdx = raw.indexOf('\n');

    if (braceIdx >= 0 && (nlIdx < 0 || braceIdx <= nlIdx)) {
      funcName = raw.slice(0, braceIdx).trim();
      argsStr = raw.slice(braceIdx);
    } else if (nlIdx >= 0) {
      funcName = raw.slice(0, nlIdx).trim();
      argsStr = raw.slice(nlIdx + 1).trim()
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?\s*```$/, '')
        .trim();
    } else {
      funcName = raw.trim();
    }

    argsStr = argsStr.replace(/<ctrl(\d+)>/g, (_, c) => String.fromCharCode(Number(c)));

    let args = {};
    if (argsStr) {
      try {
        args = JSON.parse(argsStr);
      } catch {
        try {
          const fixed = argsStr
            .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":')
            .replace(/:\s*([^",{}\[\]\d\s\-][^,}\]]*?)([,}])/g, ':"$1"$2');
          args = JSON.parse(fixed);
        } catch {
          args = { _raw: argsStr };
        }
      }
    }

    calls.push({
      id: `call_gemini_${Date.now()}_${calls.length}`,
      type: 'function',
      function: { name: funcName, arguments: JSON.stringify(args) },
    });
  }

  if (calls.length === 0) return null;

  const before = text.split(GEMINI_TC_BEGIN)[0].trim();
  const afterParts = text.split(GEMINI_TC_END);
  const after = afterParts.length > 1 ? afterParts[afterParts.length - 1].trim() : '';
  const remainingText = (before + (before && after ? ' ' : '') + after).trim();

  log(`[Gemini] Parsed ${calls.length} native tool call(s): ${calls.map(c => c.function.name).join(', ')}`);
  return { toolCalls: calls, remainingText };
}

function isGeminiToolCallPrefix(text) {
  if (!text) return false;
  const len = Math.min(text.length, GEMINI_TC_BEGIN.length);
  return GEMINI_TC_BEGIN.substring(0, len) === text.substring(0, len);
}

// ============================================================
// Anthropic ↔ OpenAI conversion (kept for legacy proxy)
// ============================================================

function anthropicToOpenAI(body) {
  const oai = {
    model: body.model,
    max_tokens: body.max_tokens || 4096,
    stream: !!body.stream,
    messages: [],
  };
  if (body.system) {
    const text = typeof body.system === 'string'
      ? body.system
      : body.system.map(b => b.text || '').join('\n');
    oai.messages.push({ role: 'system', content: text });
  }
  if (body.tools && body.tools.length > 0) {
    oai.tools = body.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
  }
  for (const msg of body.messages || []) {
    if (typeof msg.content === 'string') {
      oai.messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) {
      oai.messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    const textParts = [];
    const toolCalls = [];
    const toolResults = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        textParts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        textParts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
        });
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
          },
        });
      } else if (block.type === 'tool_result') {
        const resultContent = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map(b => b.text || '').join('\n')
            : JSON.stringify(block.content);
        toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content: resultContent });
      }
    }
    if (msg.role === 'assistant') {
      const assistantMsg = { role: 'assistant' };
      if (textParts.length > 0) {
        assistantMsg.content = textParts.length === 1 && textParts[0].type === 'text'
          ? textParts[0].text : textParts;
      } else {
        assistantMsg.content = toolCalls.length > 0 ? null : '';
      }
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      oai.messages.push(assistantMsg);
    }
    if (msg.role === 'user') {
      if (toolResults.length > 0) {
        for (const tr of toolResults) oai.messages.push(tr);
      }
      if (textParts.length > 0) {
        oai.messages.push({
          role: 'user',
          content: textParts.length === 1 && textParts[0].type === 'text'
            ? textParts[0].text : textParts,
        });
      }
      if (toolResults.length === 0 && textParts.length === 0) {
        oai.messages.push({ role: 'user', content: '' });
      }
    }
  }
  if (body.temperature !== undefined) oai.temperature = body.temperature;
  if (body.top_p !== undefined) oai.top_p = body.top_p;
  return oai;
}

function openAIToAnthropic(oaiResp, model) {
  const choice = oaiResp.choices?.[0];
  if (!choice) {
    return {
      id: oaiResp.id || `msg_${Date.now()}`,
      type: 'message', role: 'assistant', model,
      content: [{ type: 'text', text: '' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
  const content = [];
  const msg = choice.message || {};
  if (msg.content) {
    const geminiParsed = (!msg.tool_calls || msg.tool_calls.length === 0)
      ? parseGeminiNativeToolCalls(msg.content) : null;
    if (geminiParsed && geminiParsed.toolCalls.length > 0) {
      if (geminiParsed.remainingText) {
        content.push({ type: 'text', text: geminiParsed.remainingText });
      }
      for (const tc of geminiParsed.toolCalls) {
        let input;
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      choice.finish_reason = 'tool_calls';
    } else {
      content.push({ type: 'text', text: msg.content });
    }
  }
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let input;
      try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });
  const stopMap = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens' };
  return {
    id: oaiResp.id || `msg_${Date.now()}`,
    type: 'message', role: 'assistant', model, content,
    stop_reason: stopMap[choice.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: oaiResp.usage?.prompt_tokens || 0,
      output_tokens: oaiResp.usage?.completion_tokens || 0,
    },
  };
}

function streamOpenAIToAnthropic(oaiStream, res, model, onUsage) {
  const messageId = `msg_${Date.now()}`;
  let contentIndex = 0;
  let currentBlockType = null;
  let toolCallStates = {};
  let sentStart = false;
  let buffer = '';
  let finished = false;
  let usageInputTokens = 0;
  let usageOutputTokens = 0;
  let pendingTextBuf = '';
  let geminiToolMode = false;

  function send(event, data) {
    if (finished) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  }
  function sendMessageStart() {
    if (sentStart) return;
    sentStart = true;
    send('message_start', {
      type: 'message_start',
      message: {
        id: messageId, type: 'message', role: 'assistant', model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }
  function endCurrentBlock() {
    if (currentBlockType !== null) {
      send('content_block_stop', { type: 'content_block_stop', index: contentIndex - 1 });
    }
  }
  function flushPendingText() {
    if (!pendingTextBuf) return;
    if (currentBlockType !== 'text') {
      endCurrentBlock();
      currentBlockType = 'text';
      send('content_block_start', {
        type: 'content_block_start', index: contentIndex,
        content_block: { type: 'text', text: '' },
      });
      contentIndex++;
    }
    send('content_block_delta', {
      type: 'content_block_delta', index: contentIndex - 1,
      delta: { type: 'text_delta', text: pendingTextBuf },
    });
    pendingTextBuf = '';
  }
  function emitGeminiToolCalls() {
    const parsed = parseGeminiNativeToolCalls(pendingTextBuf);
    if (!parsed || parsed.toolCalls.length === 0) {
      geminiToolMode = false;
      flushPendingText();
      return;
    }
    if (parsed.remainingText) {
      const savedBuf = pendingTextBuf;
      pendingTextBuf = parsed.remainingText;
      flushPendingText();
    }
    for (const tc of parsed.toolCalls) {
      endCurrentBlock();
      currentBlockType = 'tool_use';
      send('content_block_start', {
        type: 'content_block_start', index: contentIndex,
        content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} },
      });
      contentIndex++;
      send('content_block_delta', {
        type: 'content_block_delta', index: contentIndex - 1,
        delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
      });
    }
    pendingTextBuf = '';
    geminiToolMode = false;
  }
  function flushAtEnd() {
    if (!pendingTextBuf) return;
    if (geminiToolMode || pendingTextBuf.includes(GEMINI_TC_BEGIN)) {
      emitGeminiToolCalls();
    } else {
      flushPendingText();
    }
  }

  oaiStream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        if (finished) return;
        flushAtEnd();
        endCurrentBlock();
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: currentBlockType === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: usageOutputTokens },
        });
        send('message_stop', { type: 'message_stop' });
        finished = true;
        res.end();
        if (onUsage) onUsage(usageInputTokens, usageOutputTokens);
        return;
      }
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      sendMessageStart();
      if (parsed.usage) {
        usageInputTokens = parsed.usage.prompt_tokens || usageInputTokens;
        usageOutputTokens = parsed.usage.completion_tokens || usageOutputTokens;
      }
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      const finishReason = choice.finish_reason;
      if (delta.content) {
        pendingTextBuf += delta.content;
        if (geminiToolMode) {
          if (pendingTextBuf.includes(GEMINI_TC_END)) emitGeminiToolCalls();
        } else if (pendingTextBuf.includes(GEMINI_TC_BEGIN)) {
          geminiToolMode = true;
          log('[Gemini] Detected native tool call tokens in stream');
          if (pendingTextBuf.includes(GEMINI_TC_END)) emitGeminiToolCalls();
        } else if (pendingTextBuf.length >= GEMINI_DETECT_LEN || !isGeminiToolCallPrefix(pendingTextBuf)) {
          flushPendingText();
        }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallStates[idx]) {
            endCurrentBlock();
            currentBlockType = 'tool_use';
            toolCallStates[idx] = {
              id: tc.id || `call_${Date.now()}_${idx}`,
              name: tc.function?.name || '', argsBuf: '',
            };
            send('content_block_start', {
              type: 'content_block_start', index: contentIndex,
              content_block: { type: 'tool_use', id: toolCallStates[idx].id, name: toolCallStates[idx].name, input: {} },
            });
            contentIndex++;
          }
          if (tc.function?.arguments) {
            toolCallStates[idx].argsBuf += tc.function.arguments;
            send('content_block_delta', {
              type: 'content_block_delta', index: contentIndex - 1,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            });
          }
        }
      }
      if (finishReason) {
        flushAtEnd();
        endCurrentBlock();
        const stopMap = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens' };
        const effectiveReason = currentBlockType === 'tool_use' ? 'tool_use'
          : (stopMap[finishReason] || 'end_turn');
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: effectiveReason, stop_sequence: null },
          usage: { output_tokens: usageOutputTokens },
        });
        send('message_stop', { type: 'message_stop' });
        finished = true;
        res.end();
        if (onUsage) onUsage(usageInputTokens, usageOutputTokens);
        return;
      }
    }
  });

  oaiStream.on('end', () => {
    if (!finished && !res.writableEnded) {
      flushAtEnd();
      endCurrentBlock();
      const effectiveReason = currentBlockType === 'tool_use' ? 'tool_use' : 'end_turn';
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: effectiveReason, stop_sequence: null },
        usage: { output_tokens: usageOutputTokens },
      });
      send('message_stop', { type: 'message_stop' });
      finished = true;
      res.end();
      if (onUsage) onUsage(usageInputTokens, usageOutputTokens);
    }
  });

  oaiStream.on('error', (err) => {
    log(`Stream error: ${err.message}`);
    finished = true;
    if (!res.writableEnded) res.end();
  });
}

// ============================================================
// HTTP request helper
// ============================================================

function makeRequest(url, options) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, options, resolve);
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ============================================================
// HTTP response helpers
// ============================================================

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

// ============================================================
// Static files
// ============================================================

function serveStatic(res, filePath) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
  };
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    }
  });
}

// ============================================================
// Server
// ============================================================

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {

  // ─── Bot Management API (NEW — docker exec based) ───

  // GET /api/bots — list all bots with current model from containers
  if (req.method === 'GET' && path === '/api/bots') {
    const result = {};
    for (const [botId, botCfg] of Object.entries(config.bots)) {
      const model = getCurrentModel(botCfg.container);
      result[botId] = {
        name: botCfg.name,
        container: botCfg.container,
        model: model,
        ok: model !== null,
      };
    }
    sendJson(res, 200, result);
    return;
  }

  // PUT /api/bots/:botId/model — switch model in container's openclaw.json
  if (req.method === 'PUT' && path.match(/^\/api\/bots\/[^/]+\/model$/)) {
    const botId = decodeURIComponent(path.split('/')[3]);
    const botCfg = config.bots[botId];
    if (!botCfg) {
      sendJson(res, 404, { error: `Bot "${botId}" not found` });
      return;
    }
    const body = JSON.parse(await readBody(req));
    const modelId = body.model;
    if (!modelId) {
      sendJson(res, 400, { error: 'Missing "model" in request body' });
      return;
    }
    // Validate model is in our allowed list
    const allowed = (config.modelOptions || []).map(o => o.id);
    if (allowed.length > 0 && !allowed.includes(modelId)) {
      sendJson(res, 400, { error: `Model "${modelId}" not in allowed list: ${allowed.join(', ')}` });
      return;
    }

    log(`[Config] Switching ${botCfg.name} to ${modelId} via docker exec on ${botCfg.container}`);
    const success = setCurrentModel(botCfg.container, modelId);
    if (success) {
      log(`[Config] ${botCfg.name} → ${modelId} (OpenClaw will hot-reload)`);
      sendJson(res, 200, { success: true, bot: botCfg.name, model: modelId });
    } else {
      sendJson(res, 500, { error: `Failed to update ${botCfg.container}` });
    }
    return;
  }

  // ─── Config API ───

  // GET /api/config — return gateway config (model options, bots)
  if (req.method === 'GET' && path === '/api/config') {
    sendJson(res, 200, {
      modelOptions: config.modelOptions || [],
      bots: config.bots,
    });
    return;
  }

  // ─── Telegram Notify ───
  if (req.method === 'POST' && path === '/api/notify-status') {
    // Read current status from containers for accurate notification
    const botStatuses = {};
    for (const [botId, botCfg] of Object.entries(config.bots)) {
      const model = getCurrentModel(botCfg.container);
      botStatuses[botId] = { model, ok: model !== null };
    }
    const msg = buildStatusMessage(botStatuses);
    const ok = await sendTelegram(msg);
    sendJson(res, 200, { success: ok, message: ok ? 'Notification sent' : 'Failed to send' });
    return;
  }

  // ─── Token Stats API ───
  if (req.method === 'GET' && path === '/api/stats') {
    sendJson(res, 200, tokenStats);
    return;
  }

  if (req.method === 'POST' && path === '/api/stats/reset') {
    tokenStats = {};
    statsDirty = true;
    saveStats();
    log('[Stats] Token usage statistics reset');
    sendJson(res, 200, { success: true, message: 'Stats reset' });
    return;
  }

  // ─── Status & Health ───
  if (req.method === 'GET' && path === '/api/status') {
    sendJson(res, 200, {
      uptime: process.uptime(),
      bots: Object.entries(config.bots).map(([id, b]) => ({ id, name: b.name, container: b.container })),
      modelOptions: config.modelOptions || [],
    });
    return;
  }

  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, { status: 'ok', uptime: process.uptime() });
    return;
  }

  // ─── Legacy proxy endpoint (kept as fallback, not primary path) ───
  if (req.method === 'POST' && path === '/v1/messages') {
    log('[Legacy Proxy] Received /v1/messages request — this endpoint is deprecated');
    sendJson(res, 410, {
      type: 'error',
      error: {
        type: 'deprecated',
        message: 'Direct proxy is deprecated. OpenClaw now connects directly to providers. Use the management API to switch models.',
      },
    });
    return;
  }

  // ─── Static files ───
  if (req.method === 'GET') {
    const filePath = path === '/'
      ? join(__dirname, 'public', 'index.html')
      : join(__dirname, 'public', path);
    serveStatic(res, filePath);
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });

  } catch (err) {
    log(`[Server Error] ${err.message}`);
    if (!res.writableEnded) {
      sendJson(res, 500, { error: err.message });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const botCount = Object.keys(config.bots).length;
  const modelCount = (config.modelOptions || []).length;
  log(`OpenClaw Config Manager running on http://0.0.0.0:${PORT}`);
  log(`  ${botCount} bots, ${modelCount} model options configured`);
  for (const [id, bot] of Object.entries(config.bots)) {
    log(`  ${bot.name} → container: ${bot.container}`);
  }
});

process.on('SIGINT', () => { saveStats(); log('Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { saveStats(); log('Shutting down...'); process.exit(0); });
