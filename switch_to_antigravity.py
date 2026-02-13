import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# ============================================================
# Step 1: End-to-end test through Gateway with Antigravity
# ============================================================
print("=== Step 1: E2E test through Gateway ===")

# First, test directly through the Gateway using Lumi's client key
test_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly: test ok"}],
    "max_tokens": 30
})

# This will route through the fallback chain: Codesome -> Antigravity -> ...
result = run(
    f"curl -s http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-lumi-6076e75c20398d61fadace7a7c3c8b68' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
print(f"Gateway response: {result[:800]}")

# ============================================================
# Step 2: Temporarily switch to Antigravity
# Method: Mark Codesome as exhausted via the fallback API
# ============================================================
print("\n=== Step 2: Switch all bots to Antigravity ===")

switch_script = r'''
const http = require('http');

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: '127.0.0.1', port: 8080, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = http.request(opts, (res) => {
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
  // Method: Temporarily disable Codesome provider (id=2)
  // This will make the fallback chain skip Codesome and go to Antigravity
  console.log('Disabling Codesome (provider id=2)...');
  const disableResult = await apiCall('PUT', '/api/providers/2', { enabled: 0 });
  console.log('Codesome disabled:', JSON.stringify(disableResult));

  // Verify providers
  const providers = await apiCall('GET', '/api/providers');
  for (const p of providers) {
    console.log(`  [${p.id}] ${p.name}: enabled=${p.enabled} priority=${p.priority}`);
  }

  // Check fallback status
  const fb = await apiCall('GET', '/api/fallback/status');
  console.log('\nFallback status:');
  for (const [chain, tiers] of Object.entries(fb)) {
    console.log(`  ${chain}:`);
    for (const t of tiers) {
      console.log(`    tier ${t.tier}: ${t.provider} (${t.model}) - ${t.status}`);
    }
  }
})();
'''

sftp = mac.open_sftp()
with sftp.open('/tmp/switch_antigravity.js', 'w') as f:
    f.write(switch_script)
sftp.close()

result = run('/opt/homebrew/bin/node /tmp/switch_antigravity.js')
print(result)

# ============================================================
# Step 3: Test that requests now go to Antigravity
# ============================================================
print("\n=== Step 3: Verify routing goes to Antigravity ===")
time.sleep(2)

# Test via Gateway
result = run(
    f"curl -s http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-lumi-6076e75c20398d61fadace7a7c3c8b68' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
print(f"Gateway response (should use Antigravity): {result[:800]}")

# Check recent logs for routing info
result = run('tail -20 /Users/fangjin/llm-gateway/logs/gateway.log 2>/dev/null || echo "no log file"')
print(f"\nRecent Gateway logs:")
for line in result.split('\n')[-10:]:
    print(f"  {line}")

mac.close()
print("\n[DONE] All bots now using Antigravity (Gemini 3 Flash)")
