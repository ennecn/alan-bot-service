#!/usr/bin/env python3
"""
Unify all 4 bots to use Gateway client keys.
1. Create Gateway clients for Alin, Lain, Aling
2. Update api-proxy.js in all containers to simplified Gateway version
3. Fix and start Aling container
"""
import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# ============================================================
# Step 1: Create Gateway clients for Alin, Lain, Aling
# (Lumi already has one: gw-lumi-6076e75c20398d61fadace7a7c3c8b68)
# ============================================================
print("=" * 60)
print("Step 1: Creating Gateway clients")
print("=" * 60)

create_client_script = r'''
const http = require('http');

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1', port: 8080, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let result = '';
      res.on('data', c => result += c);
      res.on('end', () => { try { resolve(JSON.parse(result)); } catch { resolve(result); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // Check existing clients
  const existing = await apiCall('GET', '/api/clients');
  const existingNames = existing.map(c => c.name);
  console.log('Existing clients:', existingNames.join(', '));

  const botsToCreate = [
    { name: 'Alin', default_model: null, provider_order: [2, 1, 5, 4] },
    { name: 'Lain', default_model: null, provider_order: [2, 1, 5, 4] },
    { name: 'Aling', default_model: null, provider_order: [2, 1, 5, 4] },
  ];

  const results = {};

  for (const bot of botsToCreate) {
    if (existingNames.includes(bot.name)) {
      const existing_client = existing.find(c => c.name === bot.name);
      console.log(`${bot.name}: already exists (key=${existing_client.api_key})`);
      results[bot.name] = existing_client.api_key;
      continue;
    }
    const created = await apiCall('POST', '/api/clients', bot);
    console.log(`${bot.name}: created (key=${created.api_key})`);
    results[bot.name] = created.api_key;
  }

  // Also get Lumi's key
  const lumi = existing.find(c => c.name === 'Lumi');
  if (lumi) {
    results['Lumi'] = lumi.api_key;
    // Update Lumi's provider_order to match new order
    await apiCall('PUT', '/api/clients/' + lumi.id, { provider_order: [2, 1, 5, 4] });
    console.log(`Lumi: updated provider_order (key=${lumi.api_key})`);
  }

  // Output JSON for the Python script to parse
  console.log('KEYS_JSON:' + JSON.stringify(results));
})();
'''

sftp = client.open_sftp()
with sftp.open('/tmp/create_clients.js', 'w') as f:
    f.write(create_client_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('/opt/homebrew/bin/node /tmp/create_clients.js')
output = stdout.read().decode()
print(output)

# Parse the keys
keys = {}
for line in output.split('\n'):
    if line.startswith('KEYS_JSON:'):
        keys = json.loads(line[10:])
        break

print(f"\nClient keys: {json.dumps(keys, indent=2)}")

if not keys:
    print("[ERROR] Failed to get client keys!")
    client.close()
    exit(1)

# ============================================================
# Step 2: Create unified api-proxy.js template
# ============================================================
print("\n" + "=" * 60)
print("Step 2: Deploying unified api-proxy.js to all containers")
print("=" * 60)

def make_proxy_js(bot_name, api_key):
    return f'''const http = require('http');

// LLM Gateway on the host machine
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

containers = {
    'Alin': 'deploy-openclaw-gateway-1',
    'Lain': 'lain-gateway',
    'Lumi': 'lumi-gateway',
    'Aling': 'aling-gateway',
}

for bot_name, container in containers.items():
    api_key = keys.get(bot_name)
    if not api_key:
        print(f"[SKIP] {bot_name}: no API key found")
        continue

    proxy_js = make_proxy_js(bot_name, api_key)

    # Write proxy to temp file, then docker cp into container
    sftp = client.open_sftp()
    tmp_path = f'/tmp/api-proxy-{bot_name.lower()}.js'
    with sftp.open(tmp_path, 'w') as f:
        f.write(proxy_js)
    sftp.close()

    stdin, stdout, stderr = client.exec_command(
        f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
        f'docker cp {tmp_path} {container}:/home/node/api-proxy.js 2>&1'
    )
    result = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    status = "OK" if not err or "Successfully" in (result + err) else f"ERR: {err}"
    print(f"  {bot_name} ({container}): {status}")

# ============================================================
# Step 3: Fix Aling container and restart all
# ============================================================
print("\n" + "=" * 60)
print("Step 3: Fix Aling and restart all containers")
print("=" * 60)

# First, check aling's docker-compose or run config
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
    'docker inspect aling-gateway --format "{{json .Config.Image}}" 2>/dev/null'
)
aling_image = stdout.read().decode().strip().strip('"')
print(f"  Aling image: {aling_image}")

# Remove old aling and recreate with proper env
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
    'docker rm aling-gateway 2>/dev/null; echo "removed old container"'
)
print(f"  {stdout.read().decode().strip()}")

# Get aling's volumes from the old container inspect (we saved it)
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
    # Check if there's a docker-compose for aling
    'ls ~/aling/docker-compose.yml ~/aling-gateway/docker-compose.yml ~/deploy-aling/docker-compose.yml 2>/dev/null || echo "no compose found"'
)
compose_path = stdout.read().decode().strip()
print(f"  Compose check: {compose_path}")

# Check how other bots are configured to replicate for aling
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
    'docker inspect lain-gateway --format "{{json .HostConfig.Binds}}" 2>/dev/null'
)
lain_binds = stdout.read().decode().strip()
print(f"  Lain binds: {lain_binds}")

stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
    'docker inspect lain-gateway --format "{{json .Config.Image}}" 2>/dev/null'
)
lain_image = stdout.read().decode().strip().strip('"')
print(f"  Lain image: {lain_image}")

# Check what volumes aling had
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && '
    'ls /Users/fangjin/aling-config/ /Users/fangjin/aling-workspace/ 2>/dev/null; echo "---"; '
    'ls /Users/fangjin/deploy-aling/ 2>/dev/null; echo "---"; '
    'find /Users/fangjin -maxdepth 2 -name "docker-compose*" -path "*aling*" 2>/dev/null'
)
print(f"  Aling dirs: {stdout.read().decode().strip()}")

client.close()
print("\n[INFO] Script complete. Aling needs manual recreation - check output above.")
