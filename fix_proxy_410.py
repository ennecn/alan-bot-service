#!/usr/bin/env python3
"""Enable /v1/messages proxy routing in Gateway V2.
Adds provider configs + bot key mapping to config.json,
replaces the 410 handler with actual proxy routing."""
import paramiko
import json

GW2_DIR = "/Users/fangjin/llm-gateway-v2"

# ============================================================
# 1. Updated config.json
# ============================================================
CONFIG = {
    "telegram": {
        "botToken": "8568137940:AAEIdl6OlnicBkbclWwziD5RU29t1rFf_iU",
        "chatId": "6564284621"
    },
    "providers": {
        "antigravity": {
            "baseUrl": "http://138.68.44.141:8045/v1",
            "apiKey": "sk-antigravity-openclaw",
            "api": "openai",
            "modelMap": {
                "claude-opus-4-6-20250514": "gemini-3-flash",
                "claude-opus-4-6": "gemini-3-flash",
                "claude-sonnet-4-5-20250514": "gemini-3-flash"
            }
        },
        "codesome": {
            "baseUrl": "https://v3.codesome.cn/v1",
            "apiKey": "sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8",
            "api": "anthropic",
            "modelMap": {}
        },
        "t8star": {
            "baseUrl": "https://ai.t8star.cn/v1",
            "apiKey": "sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW",
            "api": "anthropic",
            "modelMap": {
                "claude-opus-4-6-20250514": "claude-opus-4-6"
            }
        }
    },
    "botKeys": {
        "gw-alin-86f31cca5b0d93189ffca6887138ff41": "alin",
        "gw-lain-a90e1ca5a2110905fd0cb1279f74fd75": "lain",
        "gw-lumi-6076e75c20398d61fadace7a7c3c8b68": "lumi",
        "gw-aling-5762340acf5576d395f6cb3969c88082": "aling"
    },
    "modelOptions": [
        {"id": "antigravity/gemini-3-flash", "label": "Gemini 3 Flash (Antigravity)"},
        {"id": "codesome/claude-opus-4-6", "label": "Claude Opus 4.6 (Codesome)"},
        {"id": "t8star/claude-opus-4-6", "label": "Claude Opus 4.6 (T8star)"}
    ],
    "bots": {
        "alin":  {"name": "Alin",  "container": "deploy-openclaw-gateway-1", "provider": "antigravity"},
        "lain":  {"name": "Lain",  "container": "lain-gateway",              "provider": "antigravity"},
        "lumi":  {"name": "Lumi",  "container": "lumi-gateway",              "provider": "antigravity"},
        "aling": {"name": "Aling", "container": "aling-gateway",             "provider": "antigravity"}
    }
}

# ============================================================
# 2. Proxy handler code to replace the 410 block
# ============================================================
# This replaces lines 812-823 in server.js
OLD_BLOCK = '''  // ─── Legacy proxy endpoint (kept as fallback, not primary path) ───
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
  }'''

NEW_BLOCK = r'''  // ─── LLM Proxy endpoint ───
  if (req.method === 'POST' && path === '/v1/messages') {
    const apiKey = req.headers['x-api-key'] || '';
    const botId = config.botKeys?.[apiKey];
    if (!botId) {
      log(`[Proxy] Unknown client key: ${apiKey.slice(0, 10)}...`);
      sendJson(res, 401, { error: { type: 'auth_error', message: 'Unknown client key' } });
      return;
    }
    const botCfg = config.bots[botId];
    const providerName = botCfg?.provider || 'antigravity';
    const provider = config.providers?.[providerName];
    if (!provider) {
      sendJson(res, 500, { error: { type: 'config_error', message: `Provider "${providerName}" not configured` } });
      return;
    }

    const body = JSON.parse(await readBody(req));
    const originalModel = body.model;
    const mappedModel = provider.modelMap?.[originalModel] || originalModel;
    body.model = mappedModel;

    log(`[Proxy] ${botCfg.name} → ${providerName}: ${originalModel}${originalModel !== mappedModel ? ' → ' + mappedModel : ''} stream=${!!body.stream}`);

    if (provider.api === 'openai') {
      // Anthropic → OpenAI conversion
      const oaiBody = anthropicToOpenAI(body);
      oaiBody.model = mappedModel;
      const targetBody = JSON.stringify(oaiBody);
      const targetUrl = provider.baseUrl.replace(/\/v1$/, '') + '/v1/chat/completions';
      const isHttps = targetUrl.startsWith('https');
      const parsedUrl = new URL(targetUrl);

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'Authorization': `Bearer ${provider.apiKey}`,
        },
      };

      const mod = isHttps ? https : http;
      const proxyReq = mod.request(reqOptions, (proxyRes) => {
        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          streamOpenAIToAnthropic(proxyRes, res, originalModel, (inTok, outTok) => {
            recordUsage(botCfg.name, providerName, mappedModel, inTok, outTok);
          });
        } else {
          let respBody = '';
          proxyRes.on('data', (c) => { respBody += c; });
          proxyRes.on('end', () => {
            if (proxyRes.statusCode >= 400) {
              log(`[Proxy] ${providerName} error ${proxyRes.statusCode}: ${respBody.slice(0, 200)}`);
              sendJson(res, proxyRes.statusCode, { type: 'error', error: { type: 'upstream_error', message: respBody.slice(0, 500) } });
              return;
            }
            try {
              const oaiResp = JSON.parse(respBody);
              const anthropicResp = openAIToAnthropic(oaiResp, originalModel);
              recordUsage(botCfg.name, providerName, mappedModel, anthropicResp.usage?.input_tokens || 0, anthropicResp.usage?.output_tokens || 0);
              sendJson(res, 200, anthropicResp);
            } catch (e) {
              log(`[Proxy] Parse error: ${e.message}`);
              sendJson(res, 502, { error: { type: 'parse_error', message: respBody.slice(0, 300) } });
            }
          });
        }
      });
      proxyReq.on('error', (e) => {
        log(`[Proxy] ${providerName} connection error: ${e.message}`);
        sendJson(res, 502, { error: { type: 'proxy_error', message: e.message } });
      });
      proxyReq.setTimeout(300000, () => { proxyReq.destroy(new Error('Timeout 300s')); });
      proxyReq.write(targetBody);
      proxyReq.end();
    } else {
      // Anthropic → Anthropic passthrough (codesome, t8star)
      const targetBody = JSON.stringify(body);
      const targetUrl = provider.baseUrl.replace(/\/v1$/, '') + '/v1/messages';
      const isHttps = targetUrl.startsWith('https');
      const parsedUrl = new URL(targetUrl);

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'x-api-key': provider.apiKey,
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        },
      };
      if (req.headers['anthropic-beta']) {
        reqOptions.headers['anthropic-beta'] = req.headers['anthropic-beta'];
      }

      const mod = isHttps ? https : http;
      const proxyReq = mod.request(reqOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        if (!body.stream) {
          let respBody = '';
          proxyRes.on('data', (c) => { respBody += c; });
          proxyRes.on('end', () => {
            try {
              const parsed = JSON.parse(respBody);
              recordUsage(botCfg.name, providerName, mappedModel, parsed.usage?.input_tokens || 0, parsed.usage?.output_tokens || 0);
            } catch {}
          });
        }
      });
      proxyReq.on('error', (e) => {
        log(`[Proxy] ${providerName} connection error: ${e.message}`);
        if (!res.headersSent) sendJson(res, 502, { error: { type: 'proxy_error', message: e.message } });
      });
      proxyReq.setTimeout(300000, () => { proxyReq.destroy(new Error('Timeout 300s')); });
      proxyReq.write(targetBody);
      proxyReq.end();
    }
    return;
  }'''

# ============================================================
# DEPLOY
# ============================================================
print("Connecting to Mac Mini...")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

# Backup existing files
print("\n1. Backing up existing files...")
si, so, se = c.exec_command(f"cp {GW2_DIR}/config.json {GW2_DIR}/config.json.bak-$(date +%Y%m%d-%H%M%S)")
so.read()
si, so, se = c.exec_command(f"cp {GW2_DIR}/server.js {GW2_DIR}/server.js.bak-$(date +%Y%m%d-%H%M%S)")
so.read()
print("   Backups created")

# Write new config.json
print("\n2. Writing config.json with providers + botKeys...")
sftp = c.open_sftp()
with sftp.open(f"{GW2_DIR}/config.json", "wb") as f:
    f.write(json.dumps(CONFIG, indent=2, ensure_ascii=False).encode("utf-8"))
sftp.close()
print("   Done")

# Read current server.js, replace the 410 block
print("\n3. Patching server.js (replacing 410 handler with proxy routing)...")
si, so, se = c.exec_command(f"cat {GW2_DIR}/server.js")
server_js = so.read().decode("utf-8")

if OLD_BLOCK in server_js:
    server_js = server_js.replace(OLD_BLOCK, NEW_BLOCK)
    sftp = c.open_sftp()
    with sftp.open(f"{GW2_DIR}/server.js", "wb") as f:
        f.write(server_js.encode("utf-8"))
    sftp.close()
    print("   Patched successfully")
elif "Unknown client key" in server_js:
    print("   Already patched (proxy routing present)")
else:
    print("   WARNING: Could not find the 410 block to replace!")
    print("   Manual intervention needed")

# Restart Gateway V2
print("\n4. Restarting Gateway V2...")
si, so, se = c.exec_command("launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>/dev/null; sleep 2; launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist")
so.read()
import time
time.sleep(3)

# Verify
print("\n5. Verification...")
si, so, se = c.exec_command("curl -s http://127.0.0.1:8080/health")
health = so.read().decode().strip()
print(f"   Health: {health}")

si, so, se = c.exec_command("curl -s http://127.0.0.1:8080/api/config")
api_config = so.read().decode().strip()
try:
    cfg = json.loads(api_config)
    print(f"   Bots: {list(cfg.get('bots', {}).keys())}")
    print(f"   Models: {[m['id'] for m in cfg.get('modelOptions', [])]}")
except:
    print(f"   Config response: {api_config[:200]}")

# Test proxy with a minimal request (should get routed, not 410)
si, so, se = c.exec_command(
    'curl -s -o /dev/null -w "%{http_code}" '
    '-X POST http://127.0.0.1:8080/v1/messages '
    '-H "Content-Type: application/json" '
    '-H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    '-d \'{"model":"claude-opus-4-6","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}\''
)
status = so.read().decode().strip()
print(f"   Proxy test (Alin→antigravity): HTTP {status} (expect 200)")

c.close()
print("\nDone!")
