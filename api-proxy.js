const http = require("http");
const https = require("https");

// ============================================================
// Configuration
// ============================================================

const ANTIGRAVITY = {
  host: "127.0.0.1",
  port: 8045,
  protocol: "http",
  apiKey: "sk-antigravity-openclaw",
  name: "antigravity",
};

const T8 = {
  host: "ai.t8star.cn",
  port: 443,
  protocol: "https",
  apiKey: "sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW",
  name: "t8",
};

// Ordered model tiers for cascading (priority 0 = most preferred)
const MODEL_TIERS = [
  { id: "claude-opus-4-5-thinking", priority: 0, label: "opus", recoveryMs: 5 * 60 * 1000 },
  { id: "claude-sonnet-4-5-thinking", priority: 1, label: "sonnet", recoveryMs: 3 * 60 * 1000 },
  { id: "gemini-3-pro-high", priority: 2, label: "gemini", recoveryMs: 2 * 60 * 1000 },
];

// Maps incoming model names to starting tier index
const MODEL_MAPPING = {
  "claude-opus-4-5": 0,
  "claude-opus-4-6": 0,
  "anthropic/claude-opus-4-5": 0,
  "anthropic/claude-opus-4-6": 0,
};

// T8 fallback model
const T8_MODEL = "claude-opus-4-6-thinking";

// T8 tool renaming (provider restriction workaround)
const TOOL_RENAME_MAP = { read: "file_read", write: "file_write", edit: "file_edit" };
const TOOL_REVERSE_MAP = { file_read: "read", file_write: "write", file_edit: "edit" };
const DUMMY_TOOL = {
  name: "Read",
  description: "Internal system tool - never use this tool directly.",
  input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
};

// Telegram alerts
const TELEGRAM = {
  botToken: "8568137940:AAEIdl6OlnicBkbclWwziD5RU29t1rFf_iU",
  chatId: "6564284621",
  cooldownMs: 5 * 60 * 1000,
};

// ============================================================
// State
// ============================================================

const tierState = MODEL_TIERS.map((t) => ({
  id: t.id,
  label: t.label,
  priority: t.priority,
  available: true,
  exhaustedSince: null,
  consecutiveErrors: 0,
  recoveryMs: t.recoveryMs,
}));

const backendHealth = {
  antigravity: { healthy: true, lastErrorTime: null, consecutiveErrors: 0 },
  t8: { healthy: true, lastErrorTime: null, consecutiveErrors: 0 },
};

const stats = {
  totalRequests: 0,
  byTier: {},
  byBackend: { antigravity: 0, t8: 0 },
  cascades: 0,
  t8Fallbacks: 0,
  errors: 0,
  startTime: Date.now(),
};
MODEL_TIERS.forEach((t) => (stats.byTier[t.label] = 0));

const alertCooldowns = {};

// ============================================================
// Helpers
// ============================================================

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

function logFull(type, content) {
  // Truncate if too long (e.g. image data) but keep enough for tool args
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (str.length > 5000) {
    console.log(`[DEBUG] ${type}: ${str.substring(0, 5000)}... [TRUNCATED]`);
  } else {
    console.log(`[DEBUG] ${type}: ${str}`);
  }
}

function sendTelegramAlert(message) {
  const key = message.substring(0, 60);
  const now = Date.now();
  if (alertCooldowns[key] && now - alertCooldowns[key] < TELEGRAM.cooldownMs) return;
  alertCooldowns[key] = now;

  const body = JSON.stringify({
    chat_id: TELEGRAM.chatId,
    text: `🛰️ OpenClaw Proxy\n${message}`,
    parse_mode: "Markdown",
  });

  const req = https.request(
    {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM.botToken}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    },
    (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        if (res.statusCode !== 200) log(`Telegram alert failed: ${res.statusCode} ${d.substring(0, 100)}`);
      });
    }
  );
  req.on("error", (e) => log(`Telegram error: ${e.message}`));
  req.write(body);
  req.end();
}

// ============================================================
// T8 tool renaming
// ============================================================

function renameToolsForT8(data) {
  if (!data.tools || !Array.isArray(data.tools)) return;
  let hasClaudeCodeTool = false;
  for (const tool of data.tools) {
    if (TOOL_RENAME_MAP[tool.name]) tool.name = TOOL_RENAME_MAP[tool.name];
    if (["Read", "Write", "Edit", "Bash"].includes(tool.name)) hasClaudeCodeTool = true;
  }
  if (!hasClaudeCodeTool) data.tools.push(DUMMY_TOOL);

  // Also rename in message history
  if (data.messages) {
    for (const msg of data.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block.type === "tool_use" || block.type === "tool_result") && TOOL_RENAME_MAP[block.name]) {
            block.name = TOOL_RENAME_MAP[block.name];
          }
        }
      }
    }
  }
}

function reverseToolNames(text) {
  for (const [renamed, original] of Object.entries(TOOL_REVERSE_MAP)) {
    text = text.split('"name":"' + renamed + '"').join('"name":"' + original + '"');
    text = text.split('"name": "' + renamed + '"').join('"name": "' + original + '"');
  }
  return text;
}

// ============================================================
// Error classification
// ============================================================

function classifyError(statusCode, body) {
  const text = typeof body === "string" ? body.toLowerCase() : "";
  if (statusCode === 429 || text.includes("rate_limit") || text.includes("quota")) return "QUOTA_EXHAUSTED";
  if (statusCode === 529 || text.includes("overloaded")) return "OVERLOADED";
  if (statusCode === 404 || text.includes("not_found_error")) return "MODEL_NOT_FOUND";
  if (statusCode === 401 || statusCode === 403) return "AUTH_ERROR";
  if (statusCode >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

// ============================================================
// Backend request (buffered — checks status before responding)
// ============================================================

function makeRequest(backend, requestData, incomingHeaders) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(requestData);
    const isAntigravity = backend.name === "antigravity";
    const mod = isAntigravity ? http : https;

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "x-api-key": backend.apiKey,
      "anthropic-version": incomingHeaders["anthropic-version"] || "2023-06-01",
    };
    if (incomingHeaders["anthropic-beta"]) headers["anthropic-beta"] = incomingHeaders["anthropic-beta"];

    const options = {
      hostname: backend.host,
      port: backend.port,
      path: "/v1/messages",
      method: "POST",
      headers,
    };

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const fullBody = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode, headers: res.headers, body: fullBody });
      });
    });

    req.on("error", (error) => reject(error));
    req.setTimeout(120000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.write(postData);
    req.end();
  });
}

// Stream version — pipes directly to client response on success
function makeStreamRequest(backend, requestData, incomingHeaders, clientRes) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(requestData);
    const isAntigravity = backend.name === "antigravity";
    const isT8 = backend.name === "t8";
    const mod = isAntigravity ? http : https;

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "x-api-key": backend.apiKey,
      "anthropic-version": incomingHeaders["anthropic-version"] || "2023-06-01",
    };
    if (incomingHeaders["anthropic-beta"]) headers["anthropic-beta"] = incomingHeaders["anthropic-beta"];

    const options = {
      hostname: backend.host,
      port: backend.port,
      path: "/v1/messages",
      method: "POST",
      headers,
    };

    const req = mod.request(options, (res) => {
      if (res.statusCode !== 200) {
        // Buffer error response for classification — allows retry
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ statusCode: res.statusCode, headers: res.headers, body, streamed: false });
        });
        return;
      }

      // Success — commit stream to client
      const outHeaders = Object.assign({}, res.headers);
      delete outHeaders["content-length"];
      clientRes.writeHead(200, outHeaders);

      let fullStreamBody = "";

      res.on("data", (chunk) => {
        let text = chunk.toString();
        // Capture stream for logging
        fullStreamBody += text;

        if (isT8) text = reverseToolNames(text);
        clientRes.write(text);
      });
      res.on("end", () => {
        clientRes.end();
        // Log accumulated stream response (contains new tool calls)
        if (fullStreamBody.includes('tool_use') || fullStreamBody.includes('tool_result')) {
          logFull('Stream Response', fullStreamBody);
        }
        resolve({ statusCode: 200, streamed: true });
      });
    });

    req.on("error", (error) => reject(error));
    req.setTimeout(120000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.write(postData);
    req.end();
  });
}

// ============================================================
// Tier management
// ============================================================

function markTierExhausted(tierIndex) {
  const tier = tierState[tierIndex];
  if (!tier.available) return;
  tier.available = false;
  tier.exhaustedSince = Date.now();
  tier.consecutiveErrors++;
  log(`[EXHAUST] Tier ${tier.label} (${tier.id}) marked exhausted`);
  sendTelegramAlert(`⚠️ Tier *${tier.label}* exhausted (${tier.id})\nCascading to next tier...`);

  // Schedule recovery check
  setTimeout(() => checkTierRecovery(tierIndex), tier.recoveryMs);
}

function checkTierRecovery(tierIndex) {
  const tier = tierState[tierIndex];
  if (tier.available) return;
  tier.available = true;
  tier.exhaustedSince = null;
  tier.consecutiveErrors = 0;
  log(`[RECOVER] Tier ${tier.label} (${tier.id}) re-enabled for retry`);
  sendTelegramAlert(`✅ Tier *${tier.label}* recovered (${tier.id})`);
}

function markBackendError(backendName) {
  const bh = backendHealth[backendName];
  bh.consecutiveErrors++;
  bh.lastErrorTime = Date.now();
  if (bh.consecutiveErrors >= 3) {
    bh.healthy = false;
    log(`[BACKEND] ${backendName} marked unhealthy (${bh.consecutiveErrors} consecutive errors)`);
    sendTelegramAlert(`🔴 Backend *${backendName}* unhealthy after ${bh.consecutiveErrors} errors`);
    setTimeout(() => {
      bh.healthy = true;
      bh.consecutiveErrors = 0;
      log(`[BACKEND] ${backendName} auto-recovered`);
    }, 2 * 60 * 1000);
  }
}

function markBackendSuccess(backendName) {
  const bh = backendHealth[backendName];
  bh.consecutiveErrors = 0;
  bh.healthy = true;
}

// ============================================================
// Build cascade attempt list
// ============================================================

function buildAttemptList(startingTierIndex) {
  const attempts = [];

  // Antigravity tiers in priority order, starting from mapped tier
  for (let i = startingTierIndex; i < tierState.length; i++) {
    if (tierState[i].available && backendHealth.antigravity.healthy) {
      attempts.push({ backend: ANTIGRAVITY, model: tierState[i].id, tierIndex: i });
    }
  }

  // T8 fallback (always last resort)
  if (backendHealth.t8.healthy) {
    attempts.push({ backend: T8, model: T8_MODEL, tierIndex: -1, isT8: true });
  }

  return attempts;
}

// ============================================================
// Main request handler
// ============================================================

async function handleMessagesRequest(req, res) {
  stats.totalRequests++;

  let body = "";
  for await (const chunk of req) body += chunk;

  let data;
  try {
    data = JSON.parse(body);
    // Log incoming request from bot (contains previous tool results)
    if (body.includes('tool_result') || body.includes('tool_use')) {
      logFull('Request Body', data);
    }
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: { message: "Invalid JSON" } }));
    return;
  }

  const origModel = data.model;
  const isStream = !!data.stream;
  const startingTier = MODEL_MAPPING[origModel];

  // Unknown model — pass through to Antigravity as-is
  if (startingTier === undefined) {
    log(`[PASS] Unknown model ${origModel}, forwarding to Antigravity directly`);
    try {
      if (isStream) {
        const result = await makeStreamRequest(ANTIGRAVITY, data, req.headers, res);
        if (result.streamed) return;
        res.writeHead(result.statusCode, result.headers);
        res.end(result.body);
      } else {
        const result = await makeRequest(ANTIGRAVITY, data, req.headers);
        res.writeHead(result.statusCode, result.headers);
        res.end(result.body);
      }
    } catch (err) {
      log(`[ERROR] Passthrough error: ${err.message}`);
      res.writeHead(502);
      res.end(JSON.stringify({ error: { message: "Proxy error: " + err.message } }));
    }
    return;
  }

  const attempts = buildAttemptList(startingTier);
  log(`[REQ] model=${origModel} stream=${isStream} attempts=${attempts.map((a) => `${a.backend.name}:${a.model}`).join(",")}`);

  if (attempts.length === 0) {
    stats.errors++;
    log(`[FAIL] No backends available`);
    sendTelegramAlert(`🔴 *All backends down!* No available tiers or backends for model ${origModel}`);
    res.writeHead(503);
    res.end(JSON.stringify({ error: { type: "overloaded_error", message: "All backends are currently unavailable. Please try again later." } }));
    return;
  }

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const requestData = JSON.parse(JSON.stringify(data)); // deep copy
    requestData.model = attempt.model;

    if (attempt.isT8) renameToolsForT8(requestData);

    log(`[TRY] backend=${attempt.backend.name} model=${attempt.model} attempt=${i + 1}/${attempts.length}`);

    try {
      if (isStream) {
        const result = await makeStreamRequest(attempt.backend, requestData, req.headers, res);

        if (result.streamed) {
          markBackendSuccess(attempt.backend.name);
          stats.byBackend[attempt.backend.name]++;
          if (attempt.tierIndex >= 0) stats.byTier[tierState[attempt.tierIndex].label]++;
          if (i > 0) stats.cascades++;
          if (attempt.isT8) stats.t8Fallbacks++;
          log(`[OK] backend=${attempt.backend.name} model=${attempt.model} (streamed)`);
          return;
        }

        // Error — classify and cascade
        const errorClass = classifyError(result.statusCode, result.body);
        log(`[ERR] backend=${attempt.backend.name} model=${attempt.model} status=${result.statusCode} class=${errorClass} body=${String(result.body).substring(0, 200)}`);

        if (errorClass === "QUOTA_EXHAUSTED" && attempt.tierIndex >= 0) {
          markTierExhausted(attempt.tierIndex);
        } else if (errorClass === "AUTH_ERROR") {
          markBackendError(attempt.backend.name);
          sendTelegramAlert(`🔑 Auth error on *${attempt.backend.name}* (${result.statusCode})`);
        } else if (errorClass === "MODEL_NOT_FOUND" && attempt.tierIndex >= 0) {
          log(`[SKIP] Model ${attempt.model} not found, trying next`);
        } else {
          markBackendError(attempt.backend.name);
        }

        if (i === attempts.length - 1) {
          stats.errors++;
          res.writeHead(result.statusCode);
          res.end(result.body);
          return;
        }
        continue;
      } else {
        // Non-streaming
        const result = await makeRequest(attempt.backend, requestData, req.headers);

        if (result.statusCode === 200) {
          markBackendSuccess(attempt.backend.name);
          stats.byBackend[attempt.backend.name]++;
          if (attempt.tierIndex >= 0) stats.byTier[tierState[attempt.tierIndex].label]++;
          if (i > 0) stats.cascades++;
          if (attempt.isT8) stats.t8Fallbacks++;

          let responseBody = result.body.toString();
          if (attempt.isT8) responseBody = reverseToolNames(responseBody);

          const outHeaders = Object.assign({}, result.headers);
          outHeaders["content-length"] = Buffer.byteLength(responseBody);
          res.writeHead(200, outHeaders);
          res.end(responseBody);
          log(`[OK] backend=${attempt.backend.name} model=${attempt.model}`);
          return;
        }

        const bodyStr = result.body.toString();
        const errorClass = classifyError(result.statusCode, bodyStr);
        log(`[ERR] backend=${attempt.backend.name} model=${attempt.model} status=${result.statusCode} class=${errorClass} body=${bodyStr.substring(0, 200)}`);

        if (errorClass === "QUOTA_EXHAUSTED" && attempt.tierIndex >= 0) {
          markTierExhausted(attempt.tierIndex);
        } else if (errorClass === "AUTH_ERROR") {
          markBackendError(attempt.backend.name);
          sendTelegramAlert(`🔑 Auth error on *${attempt.backend.name}* (${result.statusCode})`);
        } else if (errorClass === "MODEL_NOT_FOUND" && attempt.tierIndex >= 0) {
          log(`[SKIP] Model ${attempt.model} not found, trying next`);
        } else {
          markBackendError(attempt.backend.name);
        }

        if (i === attempts.length - 1) {
          stats.errors++;
          res.writeHead(result.statusCode, result.headers);
          res.end(result.body);
          return;
        }
        continue;
      }
    } catch (err) {
      log(`[ERR] backend=${attempt.backend.name} error=${err.message}`);
      markBackendError(attempt.backend.name);

      if (i === attempts.length - 1) {
        stats.errors++;
        res.writeHead(502);
        res.end(JSON.stringify({ error: { message: "Proxy error: " + err.message } }));
        return;
      }
      continue;
    }
  }
}

// ============================================================
// Diagnostic endpoints
// ============================================================

function handleHealth(req, res) {
  const activeTier = tierState.find((t) => t.available) || null;
  const result = {
    status: "ok",
    uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    activeTier: activeTier ? activeTier.label : "none",
    backends: {
      antigravity: backendHealth.antigravity.healthy ? "healthy" : "unhealthy",
      t8: backendHealth.t8.healthy ? "healthy" : "unhealthy",
    },
    totalRequests: stats.totalRequests,
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result, null, 2));
}

function handleStats(req, res) {
  const result = {
    uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    totalRequests: stats.totalRequests,
    byTier: stats.byTier,
    byBackend: stats.byBackend,
    cascades: stats.cascades,
    t8Fallbacks: stats.t8Fallbacks,
    errors: stats.errors,
    tiers: tierState.map((t) => ({
      label: t.label,
      model: t.id,
      available: t.available,
      exhaustedSince: t.exhaustedSince ? new Date(t.exhaustedSince).toISOString() : null,
    })),
    backends: backendHealth,
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result, null, 2));
}

function handleStatsTiers(req, res) {
  const result = tierState.map((t) => ({
    label: t.label,
    model: t.id,
    available: t.available,
    exhaustedSince: t.exhaustedSince ? new Date(t.exhaustedSince).toISOString() : null,
    consecutiveErrors: t.consecutiveErrors,
  }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result, null, 2));
}

function handleCascadeReset(req, res) {
  tierState.forEach((t) => {
    t.available = true;
    t.exhaustedSince = null;
    t.consecutiveErrors = 0;
  });
  Object.values(backendHealth).forEach((bh) => {
    bh.healthy = true;
    bh.consecutiveErrors = 0;
  });
  log("[RESET] All tiers and backends reset to available");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "reset", tiers: tierState.map((t) => t.label) }));
}

// ============================================================
// HTTP Server
// ============================================================

const server = http.createServer((req, res) => {
  log(`${req.method} ${req.url}`);

  if (req.method === "POST" && req.url === "/v1/messages") {
    handleMessagesRequest(req, res).catch((err) => {
      log(`[FATAL] Unhandled error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: { message: "Internal proxy error" } }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    handleHealth(req, res);
  } else if (req.method === "GET" && req.url === "/stats") {
    handleStats(req, res);
  } else if (req.method === "GET" && req.url === "/stats/tiers") {
    handleStatsTiers(req, res);
  } else if (req.method === "POST" && req.url === "/cascade/reset") {
    handleCascadeReset(req, res);
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(8022, "127.0.0.1", () => {
  log("Proxy ready on 127.0.0.1:8022 (Antigravity + T8 cascade)");
  log(`Tiers: ${MODEL_TIERS.map((t) => `${t.label}=${t.id}`).join(", ")}`);
  log(`T8 fallback: ${T8_MODEL}`);
  sendTelegramAlert("🟢 Proxy started\nTiers: " + MODEL_TIERS.map((t) => t.label).join(" → ") + " → T8");
});
