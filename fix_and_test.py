#!/usr/bin/env python3
"""Fix gateway with model mapping, restart, switch Alin to T8star, and test."""
import paramiko, sys, io, os, json, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MAC = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
LOCAL_GW = r'd:\openclawVPS\llm-gateway-v2'
REMOTE_GW = '/Users/fangjin/llm-gateway-v2'
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

# Step 1: Upload fixed server.js and config.json
print("=" * 60)
print("Step 1: Upload fixed server.js + config.json")
print("=" * 60)
sftp.put(os.path.join(LOCAL_GW, 'server.js'), f'{REMOTE_GW}/server.js')
sftp.put(os.path.join(LOCAL_GW, 'config.json'), f'{REMOTE_GW}/config.json')
print("  Uploaded server.js + config.json")

# Step 2: Restart gateway
print("\nStep 2: Restart gateway")
run('launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
time.sleep(2)
run('launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
time.sleep(3)

out, _ = run('curl -s http://127.0.0.1:8080/health --max-time 5')
print(f"  Health: {out}")

# Step 3: Ensure Alin is on T8star (to test model mapping)
print("\n" + "=" * 60)
print("Step 3: Switch Alin to T8star (test model mapping)")
print("=" * 60)

switch_script = '''
const http = require('http');
const body = JSON.stringify({ provider: 't8star' });
const req = http.request({
  hostname: '127.0.0.1', port: 8080,
  path: '/api/bots/gw-alin-86f31cca5b0d93189ffca6887138ff41/provider',
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', () => { console.log('Status:', res.statusCode, 'Body:', data); });
});
req.on('error', (e) => { console.error('Error:', e.message); });
req.write(body);
req.end();
'''

with sftp.open('/tmp/switch_provider.js', 'w') as f:
    f.write(switch_script)

out, err = run('/opt/homebrew/bin/node /tmp/switch_provider.js', timeout=10)
print(f"  Switch: {out}")

# Verify status
out, _ = run('curl -s http://127.0.0.1:8080/api/status --max-time 5')
print(f"  Status: {out[:400]}")

# Step 4: Test with model claude-opus-4-6-20250514 -> should map to claude-opus-4-6
print("\n" + "=" * 60)
print("Step 4: Test T8star with model mapping")
print("=" * 60)

test_script = '''
const http = require('http');

const body = JSON.stringify({
  model: 'claude-opus-4-6-20250514',
  max_tokens: 50,
  messages: [{ role: 'user', content: 'Say hello in exactly one word.' }]
});

const req = http.request({
  hostname: '127.0.0.1', port: 8022,
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-api-key': 'gw-alin-86f31cca5b0d93189ffca6887138ff41',
    'anthropic-version': '2023-06-01'
  }
}, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      if (parsed.content) {
        console.log('Model:', parsed.model);
        console.log('Stop reason:', parsed.stop_reason);
        console.log('Content:', JSON.stringify(parsed.content));
        console.log('Usage:', JSON.stringify(parsed.usage));
        console.log('SUCCESS - T8star model mapping works!');
      } else if (parsed.error) {
        console.log('ERROR:', JSON.stringify(parsed.error));
      } else {
        console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
      }
    } catch (e) {
      console.log('Raw:', data.substring(0, 500));
    }
  });
});
req.on('error', (e) => { console.error('Error:', e.message); });
req.write(body);
req.end();
'''

with sftp.open('/tmp/test_t8star.js', 'w') as f:
    f.write(test_script)

run(f'{DOCKER} cp /tmp/test_t8star.js deploy-openclaw-gateway-1:/tmp/test_t8star.js')
out, err = run(f'{DOCKER} exec deploy-openclaw-gateway-1 node /tmp/test_t8star.js', timeout=30)
print(f"  {out}")
if err:
    print(f"  Error: {err}")

# Step 5: Also test Codesome (no mapping needed)
print("\n" + "=" * 60)
print("Step 5: Test Codesome (switch and test)")
print("=" * 60)

switch_script2 = '''
const http = require('http');
const body = JSON.stringify({ provider: 'codesome' });
const req = http.request({
  hostname: '127.0.0.1', port: 8080,
  path: '/api/bots/gw-alin-86f31cca5b0d93189ffca6887138ff41/provider',
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', () => { console.log('Switched to codesome:', res.statusCode, data); });
});
req.on('error', (e) => { console.error('Error:', e.message); });
req.write(body);
req.end();
'''

with sftp.open('/tmp/switch_codesome.js', 'w') as f:
    f.write(switch_script2)

out, _ = run('/opt/homebrew/bin/node /tmp/switch_codesome.js', timeout=10)
print(f"  {out}")

time.sleep(1)

test_codesome = '''
const http = require('http');

const body = JSON.stringify({
  model: 'claude-opus-4-6-20250514',
  max_tokens: 50,
  messages: [{ role: 'user', content: 'Say hello in exactly one word.' }]
});

const req = http.request({
  hostname: '127.0.0.1', port: 8022,
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-api-key': 'gw-alin-86f31cca5b0d93189ffca6887138ff41',
    'anthropic-version': '2023-06-01'
  }
}, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      if (parsed.content) {
        console.log('Model:', parsed.model);
        console.log('Stop reason:', parsed.stop_reason);
        console.log('Content:', JSON.stringify(parsed.content));
        console.log('SUCCESS - Codesome works!');
      } else if (parsed.error) {
        console.log('ERROR:', JSON.stringify(parsed.error));
      } else {
        console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
      }
    } catch (e) {
      console.log('Raw:', data.substring(0, 500));
    }
  });
});
req.on('error', (e) => { console.error('Error:', e.message); });
req.write(body);
req.end();
'''

with sftp.open('/tmp/test_codesome.js', 'w') as f:
    f.write(test_codesome)

run(f'{DOCKER} cp /tmp/test_codesome.js deploy-openclaw-gateway-1:/tmp/test_codesome.js')
out, err = run(f'{DOCKER} exec deploy-openclaw-gateway-1 node /tmp/test_codesome.js', timeout=30)
print(f"  {out}")
if err:
    print(f"  Error: {err}")

# Step 6: Gateway log
print("\n" + "=" * 60)
print("Step 6: Gateway log")
print("=" * 60)
out, _ = run('tail -15 /private/tmp/gateway-v2.log')
print(out)

sftp.close()
mac.close()
print("\n[DONE]")
