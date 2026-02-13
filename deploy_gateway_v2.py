#!/usr/bin/env python3
"""Deploy LLM Gateway V2 to Mac Mini and update Alin bot."""
import paramiko, sys, io, os, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MAC = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
LOCAL_GW = r'd:\openclawVPS\llm-gateway-v2'
REMOTE_GW = '/Users/fangjin/llm-gateway-v2'
DEPLOY_BASE = '/Users/fangjin/Desktop/p/docker-openclawd/deploy'
DOCKER = '/usr/local/bin/docker'

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect(MAC, username=USER, password=PASS)
sftp = mac.open_sftp()

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def upload_file(local_path, remote_path):
    sftp.put(local_path, remote_path)
    print(f"  Uploaded: {os.path.basename(local_path)}")

def write_remote(remote_path, content):
    with sftp.open(remote_path, 'w') as f:
        f.write(content)
    print(f"  Written: {remote_path}")

# ============================================================
# Step 1: Upload Gateway V2
# ============================================================
print("=" * 60)
print("Step 1: Upload Gateway V2 to Mac Mini")
print("=" * 60)

run(f'mkdir -p {REMOTE_GW}/public')

upload_file(os.path.join(LOCAL_GW, 'server.js'), f'{REMOTE_GW}/server.js')
upload_file(os.path.join(LOCAL_GW, 'config.json'), f'{REMOTE_GW}/config.json')
upload_file(os.path.join(LOCAL_GW, 'package.json'), f'{REMOTE_GW}/package.json')
upload_file(os.path.join(LOCAL_GW, 'public', 'index.html'), f'{REMOTE_GW}/public/index.html')

print("\n  Running npm install...")
out, err = run(f'cd {REMOTE_GW} && /opt/homebrew/bin/npm install 2>&1', timeout=120)
print(f"  {out[:500]}")

out, _ = run(f'ls -la {REMOTE_GW}/')
print(f"\n  Files:\n{out}")

# ============================================================
# Step 2: Stop old Gateway, start new Gateway  
# ============================================================
print("\n" + "=" * 60)
print("Step 2: Stop old Gateway, start new Gateway")
print("=" * 60)

# Stop old gateway
print("  Stopping old gateway...")
out, err = run('launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
print(f"  unload: {out} {err}")

time.sleep(2)

# Check port is free
out, _ = run('lsof -i :8080 2>&1 | grep -v WARNING | head -3')
print(f"  Port 8080: {out if out else 'FREE'}")

# Backup old plist
run('cp ~/Library/LaunchAgents/com.llm-gateway.plist ~/Library/LaunchAgents/com.llm-gateway.plist.v1bak 2>/dev/null')

# Write new plist
new_plist = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.llm-gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/fangjin/llm-gateway-v2/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/fangjin/llm-gateway-v2</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>PORT</key>
        <string>8080</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/private/tmp/gateway-v2.log</string>
    <key>StandardErrorPath</key>
    <string>/private/tmp/gateway-v2.log</string>
</dict>
</plist>'''

write_remote('/Users/fangjin/Library/LaunchAgents/com.llm-gateway.plist', new_plist)

# Start new gateway
print("  Starting new gateway...")
out, err = run('launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
print(f"  load: {out} {err}")

time.sleep(3)

# Verify
out, _ = run('curl -s http://127.0.0.1:8080/health --max-time 5')
print(f"  Health check: {out}")

out, _ = run('curl -s http://127.0.0.1:8080/api/status --max-time 5')
print(f"  Status: {out[:500]}")

# ============================================================
# Step 3: Update Alin's api-proxy.js and start.sh
# ============================================================
print("\n" + "=" * 60)
print("Step 3: Update Alin's api-proxy.js and start.sh")
print("=" * 60)

# Backup originals
print("  Backing up originals...")
run(f'cp {DEPLOY_BASE}/api-proxy.js {DEPLOY_BASE}/api-proxy.js.v1bak')
run(f'cp {DEPLOY_BASE}/start.sh {DEPLOY_BASE}/start.sh.v1bak')

# ==== New simple api-proxy.js ====
alin_api_proxy = r'''const http = require('http');

// Simple LLM Gateway V2 proxy - forwards Anthropic requests to Gateway V2
const GATEWAY_HOST = 'host.docker.internal';
const GATEWAY_PORT = 8080;
const CLIENT_API_KEY = process.env.API_KEY || 'gw-alin-86f31cca5b0d93189ffca6887138ff41';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetBody = JSON.stringify(data);

        const ts = new Date().toISOString();
        console.log(`[${ts}] ${CLIENT_API_KEY.split('-')[1] || 'unknown'}: model=${data.model} stream=${!!data.stream} tools=${data.tools ? data.tools.length : 0}`);

        const options = {
          hostname: GATEWAY_HOST,
          port: GATEWAY_PORT,
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(targetBody),
            'x-api-key': CLIENT_API_KEY,
            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
          }
        };

        // Forward anthropic-beta header if present
        if (req.headers['anthropic-beta']) {
          options.headers['anthropic-beta'] = req.headers['anthropic-beta'];
        }

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (e) => {
          console.error(`[${new Date().toISOString()}] Proxy error:`, e.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: { type: 'proxy_error', message: e.message } }));
        });

        proxyReq.write(targetBody);
        proxyReq.end();
      } catch (e) {
        console.error(`[${new Date().toISOString()}] Parse error:`, e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: { type: 'parse_error', message: e.message } }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] API proxy listening on 127.0.0.1:8022 -> Gateway V2 @ ${GATEWAY_HOST}:${GATEWAY_PORT}`);
});
'''

# ==== New simplified start.sh ====
alin_start_sh = '''#!/bin/bash
echo "[$(date)] Starting OpenClaw with Gateway V2 proxy..."

# Restore SSH keys from workspace (persist across container restarts)
if [ -d "/home/node/.openclaw/workspace/.ssh" ]; then
  mkdir -p ~/.ssh
  cp /home/node/.openclaw/workspace/.ssh/* ~/.ssh/ 2>/dev/null || true
  chmod 600 ~/.ssh/id_* 2>/dev/null || true
  echo "[$(date)] SSH keys restored from workspace"
fi

# Restore env secrets from workspace (persist across container restarts)
if [ -f "/home/node/.openclaw/workspace/.secrets/.env" ]; then
  cp /home/node/.openclaw/workspace/.secrets/.env ~/.env 2>/dev/null || true
  echo "[$(date)] Env secrets restored from workspace"
fi

echo "[$(date)] Gateway V2 handles all routing - no monkey-patches needed"

# Start API proxy in background
node /home/node/api-proxy.js &
PROXY_PID=$!
echo "[$(date)] API proxy started (PID: $PROXY_PID)"

# Wait for proxy to be ready
sleep 2

# Start OpenClaw gateway
echo "[$(date)] Starting OpenClaw gateway..."

# Claude Code setup
export PATH="/home/node/.openclaw/workspace/.claude-code:/home/node/.openclaw/workspace/.claude-code/node_modules/.bin:$PATH"
export ANTHROPIC_API_KEY="${API_KEY}"
export ANTHROPIC_BASE_URL="http://127.0.0.1:8022"
exec node dist/index.js gateway --bind lan --port 18789 --allow-unconfigured
'''

write_remote(f'{DEPLOY_BASE}/api-proxy.js', alin_api_proxy)
write_remote(f'{DEPLOY_BASE}/start.sh', alin_start_sh)
run(f'chmod +x {DEPLOY_BASE}/start.sh')

# Verify
out, _ = run(f'wc -l {DEPLOY_BASE}/api-proxy.js {DEPLOY_BASE}/start.sh')
print(f"  New file sizes:\n  {out}")

# ============================================================
# Step 4: Restart Alin container
# ============================================================
print("\n" + "=" * 60)
print("Step 4: Restart Alin container")
print("=" * 60)

# Show containers before
out, _ = run(f'{DOCKER} ps --format "table {{{{.Names}}}}\t{{{{.Status}}}}" 2>&1')
print(f"  Before restart:\n{out}")

# Restart only Alin
print("\n  Restarting Alin (deploy-openclaw-gateway-1)...")
out, err = run(f'cd {DEPLOY_BASE} && {DOCKER} compose down 2>&1', timeout=30)
print(f"  down: {out}")
if err:
    print(f"  down err: {err}")

time.sleep(2)

out, err = run(f'cd {DEPLOY_BASE} && {DOCKER} compose up -d 2>&1', timeout=60)
print(f"  up: {out}")
if err:
    print(f"  up err: {err}")

time.sleep(5)

# Check container status
out, _ = run(f'{DOCKER} ps --format "table {{{{.Names}}}}\t{{{{.Status}}}}\t{{{{.Ports}}}}" 2>&1')
print(f"\n  After restart:\n{out}")

# ============================================================
# Step 5: Verify
# ============================================================
print("\n" + "=" * 60)
print("Step 5: Verify")
print("=" * 60)

# Gateway log
out, _ = run('tail -15 /private/tmp/gateway-v2.log 2>&1')
print(f"  Gateway V2 log:\n{out}")

# Wait for container to initialize
time.sleep(3)

# Alin container logs
out, err = run(f'cd {DEPLOY_BASE} && {DOCKER} compose logs --tail 30 2>&1', timeout=15)
print(f"\n  Alin container logs:\n{out[:2000]}")

# Test: send a simple request through Alin's proxy port
print("\n  Testing Alin -> Gateway V2 flow...")
test_body = '{"model":"claude-opus-4-6-20250514","max_tokens":50,"messages":[{"role":"user","content":"Say hi"}]}'
out, _ = run(f'''curl -s http://127.0.0.1:8022/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "anthropic-version: 2023-06-01" \
  -d '{test_body}' --max-time 30''')
print(f"  Response: {out[:500]}")

sftp.close()
mac.close()
print("\n" + "=" * 60)
print("[DEPLOY COMPLETE]")
print("=" * 60)
