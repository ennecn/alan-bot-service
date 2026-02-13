#!/usr/bin/env python3
"""Step 2: Restart lain, lumi, aling containers to force config reload.
Step 3: Fix Gateway V2 streaming bug.
Step 4: Add missing tools config to lain and aling."""
import paramiko
import json
import time

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

DOCKER = "/usr/local/bin/docker"
BASE = "/Users/fangjin/Desktop/p/docker-openclawd"
GW2_DIR = "/Users/fangjin/llm-gateway-v2"

# ============================================================
# Step 2: Restart other 3 containers
# ============================================================
print("=" * 60)
print("STEP 2: Restart lain, lumi, aling containers")
print("=" * 60)

containers_to_restart = [
    ("deploy-lain", "lain-gateway"),
    ("deploy-lumi", "lumi-gateway"),
    ("deploy-aling", "aling-gateway"),
]

for deploy_dir, container_name in containers_to_restart:
    full_dir = f"{BASE}/{deploy_dir}"
    print(f"\n  Restarting {container_name}...")
    cmd = f"cd {full_dir} && {DOCKER} compose down && {DOCKER} compose up -d"
    si, so, se = c.exec_command(cmd)
    out = so.read().decode().strip()
    err = se.read().decode().strip()
    if out:
        print(f"    stdout: {out[:200]}")
    if err:
        # docker compose outputs to stderr normally
        for line in err.split('\n'):
            if 'error' in line.lower() or 'Error' in line:
                print(f"    ERROR: {line}")
            elif 'Started' in line or 'Running' in line or 'Created' in line:
                print(f"    {line}")

print("\n  Waiting 15s for containers to start and run start.sh...")
time.sleep(15)

# Verify containers are running
print("\n  Verifying containers...")
si, so, se = c.exec_command(f"{DOCKER} ps --format '{{{{.Names}}}}\\t{{{{.Status}}}}' | grep -E 'lain|lumi|aling'")
out = so.read().decode().strip()
for line in out.split('\n'):
    if line.strip():
        print(f"    {line}")

# Verify api-proxy is running in each container
for _, container_name in containers_to_restart:
    si, so, se = c.exec_command(f"{DOCKER} exec {container_name} pgrep -f 'api-proxy.js' 2>/dev/null")
    pid = so.read().decode().strip()
    print(f"    {container_name} api-proxy PID: {pid or 'NOT RUNNING!'}")

# Verify models.generated.js is patched
for _, container_name in containers_to_restart:
    si, so, se = c.exec_command(f"""{DOCKER} exec {container_name} sh -c "grep -c '127.0.0.1:8022' /app/node_modules/.pnpm/@mariozechner+pi-ai*/node_modules/@mariozechner/pi-ai/dist/models.generated.js 2>/dev/null || echo 0" """)
    count = so.read().decode().strip()
    print(f"    {container_name} models.generated.js patches: {count}")

# Verify config inside containers
for _, container_name in containers_to_restart:
    si, so, se = c.exec_command(f"""{DOCKER} exec {container_name} node -e "const c=JSON.parse(require('fs').readFileSync('/home/node/.openclaw/openclaw.json','utf8')); console.log(JSON.stringify({{model: c.agents?.defaults?.model?.primary, providers: Object.keys(c.models?.providers||{{}})}}))" """)
    out = so.read().decode().strip()
    print(f"    {container_name} config: {out[:200]}")

# ============================================================
# Step 3: Fix Gateway V2 streaming bug
# ============================================================
print("\n" + "=" * 60)
print("STEP 3: Fix Gateway V2 streaming bug")
print("=" * 60)

# Read current server.js
si, so, se = c.exec_command(f"cat {GW2_DIR}/server.js")
js = so.read().decode("utf-8")

# Backup
si, so, se = c.exec_command(f"cp {GW2_DIR}/server.js {GW2_DIR}/server.js.bak-step3")
so.read()

# Fix 3a: In the proxy handler, check upstream status code before streaming
OLD_STREAM_START = """        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          streamOpenAIToAnthropic(proxyRes, res, originalModel, (inTok, outTok) => {
            recordUsage(botCfg.name, providerName, mappedModel, inTok, outTok);
          });"""

NEW_STREAM_START = """        if (body.stream) {
          if (proxyRes.statusCode >= 400) {
            // Upstream error — collect body and return as Anthropic error JSON
            let errBody = '';
            proxyRes.on('data', (c) => { errBody += c; });
            proxyRes.on('end', () => {
              log(`[Proxy] ${providerName} stream error ${proxyRes.statusCode}: ${errBody.slice(0, 200)}`);
              sendJson(res, proxyRes.statusCode, { type: 'error', error: { type: 'upstream_error', message: errBody.slice(0, 500) } });
            });
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          streamOpenAIToAnthropic(proxyRes, res, originalModel, (inTok, outTok) => {
            recordUsage(botCfg.name, providerName, mappedModel, inTok, outTok);
          });"""

if OLD_STREAM_START in js:
    js = js.replace(OLD_STREAM_START, NEW_STREAM_START)
    print("  Fix 3a: Added upstream status code check before streaming")
else:
    print("  Fix 3a: Already applied or pattern not found")

# Fix 3b: In streamOpenAIToAnthropic's on('end') handler, call sendMessageStart()
OLD_ON_END = """  oaiStream.on('end', () => {
    if (!finished && !res.writableEnded) {
      flushAtEnd();
      endCurrentBlock();
      const effectiveReason = currentBlockType === 'tool_use' ? 'tool_use' : 'end_turn';
      send('message_delta', {"""

NEW_ON_END = """  oaiStream.on('end', () => {
    if (!finished && !res.writableEnded) {
      sendMessageStart();
      flushAtEnd();
      endCurrentBlock();
      const effectiveReason = currentBlockType === 'tool_use' ? 'tool_use' : 'end_turn';
      send('message_delta', {"""

if OLD_ON_END in js:
    js = js.replace(OLD_ON_END, NEW_ON_END)
    print("  Fix 3b: Added sendMessageStart() in on('end') handler")
else:
    print("  Fix 3b: Already applied or pattern not found")

# Fix 3c: In the [DONE] handler, also call sendMessageStart() for safety
OLD_DONE = """      if (data === '[DONE]') {
        if (finished) return;
        flushAtEnd();
        endCurrentBlock();"""

NEW_DONE = """      if (data === '[DONE]') {
        if (finished) return;
        sendMessageStart();
        flushAtEnd();
        endCurrentBlock();"""

if OLD_DONE in js:
    js = js.replace(OLD_DONE, NEW_DONE)
    print("  Fix 3c: Added sendMessageStart() in [DONE] handler")
else:
    print("  Fix 3c: Already applied or pattern not found")

# Write patched server.js
sftp = c.open_sftp()
with sftp.open(f"{GW2_DIR}/server.js", "wb") as f:
    f.write(js.encode("utf-8"))
sftp.close()

# Restart Gateway V2
print("\n  Restarting Gateway V2...")
si, so, se = c.exec_command("launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>/dev/null; sleep 2; launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist")
so.read()
time.sleep(3)

si, so, se = c.exec_command("curl -s http://127.0.0.1:8080/health")
health = so.read().decode().strip()
print(f"  Gateway V2 health: {health}")

# ============================================================
# Step 4: Add missing tools config to lain and aling
# ============================================================
print("\n" + "=" * 60)
print("STEP 4: Add missing tools config to lain and aling")
print("=" * 60)

TOOLS_SECTION = {
    "web": {
        "search": {
            "apiKey": "BSADps1Sr_Xhuvb6ezCOy2knSxelDKT"
        }
    },
    "elevated": {
        "enabled": True,
        "allowFrom": {
            "telegram": ["6564284621"]
        }
    },
    "exec": {
        "security": "full"
    }
}

bots_to_fix = {
    "lain": f"{BASE}/deploy-lain/config/openclaw.json",
    "aling": f"{BASE}/deploy-aling/config/openclaw.json",
}

for bot_name, config_path in bots_to_fix.items():
    print(f"\n  Fixing {bot_name}...")
    si, so, se = c.exec_command(f"cat {config_path}")
    raw = so.read().decode()
    try:
        cfg = json.loads(raw)
    except:
        print(f"    ERROR: Could not parse {config_path}")
        continue

    changed = False

    # Add tools section if missing or incomplete
    if "tools" not in cfg or not cfg["tools"].get("exec", {}).get("security"):
        cfg["tools"] = TOOLS_SECTION
        changed = True
        print(f"    Added tools section (exec.security, web.search, elevated)")

    # Ensure streamMode is "partial" (like alin)
    telegram = cfg.get("channels", {}).get("telegram", {})
    if telegram.get("streamMode") == "off":
        telegram["streamMode"] = "partial"
        changed = True
        print(f"    Changed streamMode: off → partial")

    if changed:
        sftp = c.open_sftp()
        with sftp.open(config_path, "wb") as f:
            f.write(json.dumps(cfg, indent=4, ensure_ascii=False).encode("utf-8"))
        sftp.close()
        print(f"    Config updated")
    else:
        print(f"    No changes needed")

# Also fix lumi's streamMode (it has tools.exec but streamMode is off)
lumi_path = f"{BASE}/deploy-lumi/config/openclaw.json"
si, so, se = c.exec_command(f"cat {lumi_path}")
raw = so.read().decode()
try:
    cfg = json.loads(raw)
    telegram = cfg.get("channels", {}).get("telegram", {})
    if telegram.get("streamMode") == "off":
        telegram["streamMode"] = "partial"
        sftp = c.open_sftp()
        with sftp.open(lumi_path, "wb") as f:
            f.write(json.dumps(cfg, indent=4, ensure_ascii=False).encode("utf-8"))
        sftp.close()
        print(f"\n  lumi: Changed streamMode: off → partial")
    else:
        print(f"\n  lumi: streamMode already correct")
except:
    print(f"\n  lumi: ERROR parsing config")

# ============================================================
# Final verification
# ============================================================
print("\n" + "=" * 60)
print("FINAL VERIFICATION")
print("=" * 60)

# Check all containers
si, so, se = c.exec_command(f"{DOCKER} ps --format '{{{{.Names}}}}\\t{{{{.Status}}}}' | grep -E 'deploy|lain|lumi|aling'")
out = so.read().decode().strip()
print("\nContainers:")
for line in out.split('\n'):
    if line.strip():
        print(f"  {line}")

# Check Gateway V2 bots
si, so, se = c.exec_command("curl -s http://127.0.0.1:8080/api/bots")
bots_resp = so.read().decode().strip()
try:
    bots_data = json.loads(bots_resp)
    print("\nGateway V2 bots:")
    for bid, info in bots_data.items():
        print(f"  {info['name']}: model={info.get('model','?')} provider={info.get('provider','?')} ok={info.get('ok')}")
except:
    print(f"\nGateway V2 bots: {bots_resp[:200]}")

# Test proxy with streaming for one of the fixed bots
print("\nTesting proxy (Lain → antigravity, stream=false)...")
si, so, se = c.exec_command(
    'curl -s -o /dev/null -w "%{http_code}" '
    '-X POST http://127.0.0.1:8080/v1/messages '
    '-H "Content-Type: application/json" '
    '-H "x-api-key: gw-lain-a90e1ca5a2110905fd0cb1279f74fd75" '
    '-d \'{"model":"claude-opus-4-6","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}\''
)
status = so.read().decode().strip()
print(f"  HTTP {status}")

c.close()
print("\nAll steps complete!")
