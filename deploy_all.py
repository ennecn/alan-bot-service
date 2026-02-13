#!/usr/bin/env python3
"""
Unified deployment: Update all 4 bots to use Gateway client keys.
1. Write new api-proxy.js to HOST paths (volume-mounted into containers)
2. Update .env files with Gateway client keys
3. Restart running containers, start stopped Aling
"""
import paramiko, time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

def run(cmd, show=True):
    stdin, stdout, stderr = client.exec_command(f'{PATH_PREFIX} && {cmd}')
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if show:
        if out: print(f"  {out}")
        if err: print(f"  [stderr] {err}")
    return out, err

# ============================================================
# Config
# ============================================================
keys = {
    "Alin": "gw-alin-86f31cca5b0d93189ffca6887138ff41",
    "Lain": "gw-lain-a90e1ca5a2110905fd0cb1279f74fd75",
    "Aling": "gw-aling-5762340acf5576d395f6cb3969c88082",
    "Lumi": "gw-lumi-6076e75c20398d61fadace7a7c3c8b68"
}

base = '/Users/fangjin/Desktop/p/docker-openclawd'
bots = {
    'Alin':  {'dir': f'{base}/deploy',       'container': 'deploy-openclaw-gateway-1', 'compose_dir': f'{base}/deploy'},
    'Lain':  {'dir': f'{base}/deploy-lain',   'container': 'lain-gateway',             'compose_dir': f'{base}/deploy-lain'},
    'Lumi':  {'dir': f'{base}/deploy-lumi',   'container': 'lumi-gateway',             'compose_dir': f'{base}/deploy-lumi'},
    'Aling': {'dir': f'{base}/deploy-aling',  'container': 'aling-gateway',            'compose_dir': f'{base}/deploy-aling'},
}

def make_proxy_js(bot_name, api_key):
    return f'''const http = require('http');

// Unified LLM Gateway proxy - {bot_name}
const GATEWAY_HOST = 'host.docker.internal';
const GATEWAY_PORT = 8080;
const CLIENT_API_KEY = '{api_key}';

const server = http.createServer((req, res) => {{
  if (req.method === 'POST' && req.url === '/v1/messages') {{
    let body = '';

    req.on('data', chunk => {{
      body += chunk.toString();
    }});

    req.on('end', () => {{
      try {{
        const data = JSON.parse(body);
        const targetBody = JSON.stringify(data);

        console.log(`[${{new Date().toISOString()}}] {bot_name}: model=${{data.model}} stream=${{!!data.stream}}`);

        const options = {{
          hostname: GATEWAY_HOST,
          port: GATEWAY_PORT,
          path: '/v1/messages',
          method: 'POST',
          headers: {{
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(targetBody),
            'x-api-key': CLIENT_API_KEY,
            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
          }}
        }};

        if (req.headers['anthropic-beta']) {{
          options.headers['anthropic-beta'] = req.headers['anthropic-beta'];
        }}

        const proxyReq = http.request(options, (proxyRes) => {{
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }});

        proxyReq.on('error', (e) => {{
          console.error('[Proxy] Error:', e.message);
          res.writeHead(502);
          res.end(JSON.stringify({{ error: {{ type: 'proxy_error', message: e.message }} }}));
        }});

        proxyReq.setTimeout(300000, () => {{
          proxyReq.destroy(new Error('Request timeout (300s)'));
        }});

        proxyReq.write(targetBody);
        proxyReq.end();

      }} catch (e) {{
        console.error('[Proxy] Parse error:', e);
        res.writeHead(400);
        res.end(JSON.stringify({{ error: 'Invalid JSON' }}));
      }}
    }});
  }} else if (req.url === '/health') {{
    res.writeHead(200);
    res.end(JSON.stringify({{ status: 'ok', target: 'llm-gateway:8080', client: '{bot_name}' }}));
  }} else {{
    res.writeHead(404);
    res.end('Not Found');
  }}
}});

server.listen(8022, '127.0.0.1', () => {{
  console.log('[Proxy] {bot_name} ready on http://127.0.0.1:8022 -> LLM Gateway');
}});
'''

# ============================================================
# Step 1: Write api-proxy.js to HOST paths
# ============================================================
print("=" * 60)
print("Step 1: Writing unified api-proxy.js to host paths")
print("=" * 60)

sftp = client.open_sftp()
for bot_name, info in bots.items():
    proxy_path = f"{info['dir']}/api-proxy.js"
    proxy_content = make_proxy_js(bot_name, keys[bot_name])
    with sftp.open(proxy_path, 'w') as f:
        f.write(proxy_content)
    print(f"  [OK] {bot_name}: {proxy_path}")
sftp.close()

# ============================================================
# Step 2: Update .env files with Gateway client keys
# ============================================================
print("\n" + "=" * 60)
print("Step 2: Updating .env files")
print("=" * 60)

sftp = client.open_sftp()
for bot_name, info in bots.items():
    env_path = f"{info['dir']}/.env"
    env_content = f"API_KEY={keys[bot_name]}\nGATEWAY_TOKEN=mysecrettoken123\n"
    with sftp.open(env_path, 'w') as f:
        f.write(env_content)
    print(f"  [OK] {bot_name}: API_KEY={keys[bot_name]}")
sftp.close()

# ============================================================
# Step 3: Restart all containers
# ============================================================
print("\n" + "=" * 60)
print("Step 3: Restarting containers")
print("=" * 60)

# First, restart the 3 running containers
for bot_name in ['Alin', 'Lain', 'Lumi']:
    container = bots[bot_name]['container']
    print(f"\n  Restarting {bot_name} ({container})...")
    run(f'docker restart {container}')

# For Aling, use docker-compose up
print(f"\n  Starting Aling via docker-compose...")
run(f'cd {bots["Aling"]["compose_dir"]} && docker compose up -d')

# Wait for containers to start
print("\n  Waiting 10s for containers to initialize...")
time.sleep(10)

# ============================================================
# Step 4: Verify all containers are running
# ============================================================
print("\n" + "=" * 60)
print("Step 4: Verification")
print("=" * 60)

for bot_name, info in bots.items():
    container = info['container']
    print(f"\n  --- {bot_name} ({container}) ---")
    
    # Check status
    out, _ = run(f'docker inspect {container} --format "{{{{.State.Status}}}}" 2>/dev/null', show=False)
    print(f"    Status: {out}")
    
    # Check proxy logs
    out, _ = run(f'docker logs {container} --tail 5 2>&1 | tail -5', show=False)
    for line in out.split('\n'):
        print(f"    {line}")

# Test health endpoints
print("\n  --- Health checks ---")
for bot_name, info in bots.items():
    container = info['container']
    out, _ = run(f'docker exec {container} curl -s http://127.0.0.1:8022/health 2>/dev/null || echo "UNREACHABLE"', show=False)
    print(f"    {bot_name}: {out}")

client.close()
print("\n[DONE] All bots unified to Gateway client keys.")
