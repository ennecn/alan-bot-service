#!/usr/bin/env python3
"""Test Alin -> Gateway V2 connectivity from Mac Mini."""
import paramiko, sys, io, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MAC = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
DOCKER = '/usr/local/bin/docker'

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect(MAC, username=USER, password=PASS)

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Write test script inside the container
test_script = r'''
const http = require('http');

const body = JSON.stringify({
  model: 'claude-opus-4-6-20250514',
  max_tokens: 50,
  messages: [{ role: 'user', content: 'Say hi in exactly one word.' }]
});

const options = {
  hostname: '127.0.0.1',
  port: 8022,
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-api-key': 'gw-alin-86f31cca5b0d93189ffca6887138ff41',
    'anthropic-version': '2023-06-01'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 1000));
    } catch (e) {
      console.log('Raw:', data.substring(0, 500));
    }
  });
});

req.on('error', (e) => { console.error('Error:', e.message); });
req.write(body);
req.end();
'''

# Write the test script to the Mac Mini
with paramiko.SFTPClient.from_transport(mac.get_transport()) as sftp:
    with sftp.open('/tmp/test_alin_gw2.js', 'w') as f:
        f.write(test_script)

# Execute inside the container using docker cp + exec
print("=== Test 1: Alin -> Gateway V2 (non-streaming) ===")
out, err = run(f'{DOCKER} cp /tmp/test_alin_gw2.js deploy-openclaw-gateway-1:/tmp/test_alin_gw2.js')
out, err = run(f'{DOCKER} exec deploy-openclaw-gateway-1 node /tmp/test_alin_gw2.js', timeout=30)
print(f"stdout: {out}")
if err:
    print(f"stderr: {err}")

# Also test directly from host to gateway
print("\n=== Test 2: Direct Gateway V2 health ===")
out, _ = run('curl -s http://127.0.0.1:8080/health --max-time 5')
print(f"Health: {out}")

print("\n=== Test 3: Direct Gateway V2 API (from host) ===")
# Write the request body to a file first to avoid shell quoting issues
with paramiko.SFTPClient.from_transport(mac.get_transport()) as sftp:
    req_body = json.dumps({
        "model": "claude-opus-4-6-20250514",
        "max_tokens": 50,
        "messages": [{"role": "user", "content": "Say hi in one word"}]
    })
    with sftp.open('/tmp/gw2_test_body.json', 'w') as f:
        f.write(req_body)

out, _ = run('''curl -s http://127.0.0.1:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "anthropic-version: 2023-06-01" \
  -d @/tmp/gw2_test_body.json --max-time 30''')
print(f"Response: {out[:500]}")

# Check gateway log for routing
print("\n=== Gateway V2 log (recent) ===")
out, _ = run('tail -10 /private/tmp/gateway-v2.log')
print(out)

# Check Alin container logs
print("\n=== Alin container logs (recent) ===")
out, _ = run(f'cd /Users/fangjin/Desktop/p/docker-openclawd/deploy && {DOCKER} compose logs --tail 10 2>&1', timeout=10)
print(out[:1000])

mac.close()
print("\n[DONE]")
