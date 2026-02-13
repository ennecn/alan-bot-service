#!/usr/bin/env python3
"""Patch Gateway V2 server.js:
1. Fix error handling for non-JSON upstream responses
2. Auto-sync proxy provider when model is switched via Web UI
3. Add PUT /api/bots/:botId/provider endpoint
"""
import paramiko

GW2_DIR = "/Users/fangjin/llm-gateway-v2"

print("Connecting to Mac Mini...")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

# Read current server.js
si, so, se = c.exec_command(f"cat {GW2_DIR}/server.js")
js = so.read().decode("utf-8")

# ============================================================
# Patch 1: Fix non-JSON error handling in proxy
# ============================================================
OLD_ERR = """            try {
              const oaiResp = JSON.parse(respBody);
              if (proxyRes.statusCode >= 400) {
                log(`[Proxy] ${providerName} error ${proxyRes.statusCode}: ${respBody.slice(0, 200)}`);
                sendJson(res, proxyRes.statusCode, { type: 'error', error: { type: 'upstream_error', message: respBody.slice(0, 500) } });
                return;
              }
              const anthropicResp = openAIToAnthropic(oaiResp, originalModel);
              recordUsage(botCfg.name, providerName, mappedModel, anthropicResp.usage?.input_tokens || 0, anthropicResp.usage?.output_tokens || 0);
              sendJson(res, 200, anthropicResp);
            } catch (e) {
              log(`[Proxy] Parse error: ${e.message}`);
              sendJson(res, 502, { error: { type: 'parse_error', message: e.message } });
            }"""

NEW_ERR = """            if (proxyRes.statusCode >= 400) {
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
            }"""

if OLD_ERR in js:
    js = js.replace(OLD_ERR, NEW_ERR)
    print("Patch 1: Fixed non-JSON error handling")
else:
    print("Patch 1: Already applied or not found")

# ============================================================
# Patch 2: Auto-sync provider when model is switched
# Add after the setCurrentModel call in PUT /api/bots/:botId/model
# ============================================================
OLD_MODEL_SWITCH = """    log(`[Config] Switching ${botCfg.name} to ${modelId} via docker exec on ${botCfg.container}`);
    const success = setCurrentModel(botCfg.container, modelId);
    if (success) {
      log(`[Config] ${botCfg.name} → ${modelId} (OpenClaw will hot-reload)`);
      sendJson(res, 200, { success: true, bot: botCfg.name, model: modelId });"""

NEW_MODEL_SWITCH = """    log(`[Config] Switching ${botCfg.name} to ${modelId} via docker exec on ${botCfg.container}`);
    const success = setCurrentModel(botCfg.container, modelId);
    if (success) {
      // Auto-sync proxy provider based on model prefix
      const providerPrefix = modelId.split('/')[0];
      if (config.providers?.[providerPrefix]) {
        config.bots[botId].provider = providerPrefix;
        saveConfig();
        log(`[Config] ${botCfg.name} proxy provider → ${providerPrefix}`);
      }
      log(`[Config] ${botCfg.name} → ${modelId} (OpenClaw will hot-reload)`);
      sendJson(res, 200, { success: true, bot: botCfg.name, model: modelId, provider: config.bots[botId].provider });"""

if OLD_MODEL_SWITCH in js:
    js = js.replace(OLD_MODEL_SWITCH, NEW_MODEL_SWITCH)
    print("Patch 2: Added auto-sync provider on model switch")
else:
    print("Patch 2: Already applied or not found")

# ============================================================
# Patch 3: Add PUT /api/bots/:botId/provider endpoint
# Insert before the Config API section
# ============================================================
PROVIDER_ENDPOINT = """
  // PUT /api/bots/:botId/provider — switch proxy provider for a bot
  if (req.method === 'PUT' && path.match(/^\\/api\\/bots\\/[^/]+\\/provider$/)) {
    const botId = decodeURIComponent(path.split('/')[3]);
    const botCfg = config.bots[botId];
    if (!botCfg) {
      sendJson(res, 404, { error: `Bot "${botId}" not found` });
      return;
    }
    const body = JSON.parse(await readBody(req));
    const providerName = body.provider;
    if (!providerName || !config.providers?.[providerName]) {
      sendJson(res, 400, { error: `Provider "${providerName}" not configured. Available: ${Object.keys(config.providers || {}).join(', ')}` });
      return;
    }
    config.bots[botId].provider = providerName;
    saveConfig();
    log(`[Config] ${botCfg.name} proxy provider → ${providerName}`);
    sendJson(res, 200, { success: true, bot: botCfg.name, provider: providerName });
    return;
  }

"""

ANCHOR = "  // ─── Config API ───"
if "api/bots.*provider" not in js and ANCHOR in js:
    js = js.replace(ANCHOR, PROVIDER_ENDPOINT + "  " + ANCHOR.lstrip())
    print("Patch 3: Added PUT /api/bots/:botId/provider endpoint")
else:
    print("Patch 3: Already applied or not found")

# ============================================================
# Patch 4: Include provider info in GET /api/bots response
# ============================================================
OLD_BOTS_RESP = """      result[botId] = {
        name: botCfg.name,
        container: botCfg.container,
        model: model,
        ok: model !== null,
      };"""

NEW_BOTS_RESP = """      result[botId] = {
        name: botCfg.name,
        container: botCfg.container,
        model: model,
        provider: botCfg.provider || 'antigravity',
        ok: model !== null,
      };"""

if OLD_BOTS_RESP in js:
    js = js.replace(OLD_BOTS_RESP, NEW_BOTS_RESP)
    print("Patch 4: Added provider to GET /api/bots response")
else:
    print("Patch 4: Already applied or not found")

# ============================================================
# Patch 5: Include providers in GET /api/config response
# ============================================================
OLD_CONFIG_RESP = """    sendJson(res, 200, {
      modelOptions: config.modelOptions || [],
      bots: config.bots,
    });"""

NEW_CONFIG_RESP = """    sendJson(res, 200, {
      modelOptions: config.modelOptions || [],
      bots: config.bots,
      providers: Object.fromEntries(
        Object.entries(config.providers || {}).map(([k, v]) => [k, { api: v.api, baseUrl: v.baseUrl }])
      ),
    });"""

if OLD_CONFIG_RESP in js:
    js = js.replace(OLD_CONFIG_RESP, NEW_CONFIG_RESP)
    print("Patch 5: Added providers to GET /api/config response")
else:
    print("Patch 5: Already applied or not found")

# Write patched server.js
sftp = c.open_sftp()
with sftp.open(f"{GW2_DIR}/server.js", "wb") as f:
    f.write(js.encode("utf-8"))
sftp.close()

# Restart Gateway V2
print("\nRestarting Gateway V2...")
si, so, se = c.exec_command("launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>/dev/null; sleep 2; launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist")
so.read()

import time
time.sleep(3)

# Verify
si, so, se = c.exec_command("curl -s http://127.0.0.1:8080/health")
print(f"Health: {so.read().decode().strip()}")

si, so, se = c.exec_command("curl -s http://127.0.0.1:8080/api/bots")
import json
bots = json.loads(so.read().decode().strip())
for bid, info in bots.items():
    print(f"  {info['name']}: model={info.get('model','?')} provider={info.get('provider','?')} ok={info.get('ok')}")

c.close()
print("\nDone!")
