import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Update Antigravity base_url to include /v1
update_script = r'''
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
  const result = await apiCall('PUT', '/api/providers/1', {
    base_url: 'http://138.68.44.141:8045/v1'
  });
  console.log('Antigravity base_url:', result.base_url);
  console.log('Antigravity api_format:', result.api_format);
})();
'''

sftp = mac.open_sftp()
with sftp.open('/tmp/fix_ag_url.js', 'w') as f:
    f.write(update_script)
sftp.close()

print(run('/opt/homebrew/bin/node /tmp/fix_ag_url.js'))

# Test
print("\n=== Testing ===")
time.sleep(1)

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
    if any(kw in line for kw in ['Router', 'Antigravity', 'error', 'Error', 'Sanitize']):
        print(f"  {line}")

mac.close()
print("\n[DONE]")
