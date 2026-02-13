import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Change Antigravity from api_format=anthropic to api_format=openai
# This makes the Gateway convert Anthropic -> OpenAI format BEFORE sending
# Antigravity at 8045 supports OpenAI format natively
print("=== Updating Antigravity provider api_format to openai ===")

update_script = r'''
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
  // Update Antigravity (id=1) api_format to openai
  const result = await apiCall('PUT', '/api/providers/1', { api_format: 'openai' });
  console.log('Update result:', JSON.stringify(result));
  
  // Verify
  const providers = await apiCall('GET', '/api/providers');
  const ag = providers.find(p => p.name === 'Antigravity');
  console.log(`Antigravity: api_format=${ag.api_format}, base_url=${ag.base_url}`);
})();
'''

sftp = mac.open_sftp()
with sftp.open('/tmp/update_ag_format.js', 'w') as f:
    f.write(update_script)
sftp.close()

result = run('/opt/homebrew/bin/node /tmp/update_ag_format.js')
print(result)

# Now test - this should use OpenAI format to Antigravity
print("\n=== Testing request through Gateway ===")
time.sleep(2)

test_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly: format fix OK"}],
    "max_tokens": 50,
    "thinking": {"type": "enabled", "budget_tokens": 5000},
    "stream": True
})
result = run(
    f"curl -s http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
print(f"Response: {result[:800]}")

# Check logs
time.sleep(1)
logs = run('tail -10 /tmp/gateway.log 2>/dev/null')
print(f"\nGateway logs:")
for line in logs.split('\n'):
    if any(kw in line for kw in ['Router', 'Antigravity', 'openai', 'error', 'Error', '400', 'Sanitize']):
        print(f"  {line}")

mac.close()
print("\n[DONE]")
