#!/usr/bin/env python3
"""
Verify the full flow: switch model via API -> check OpenClaw log for hot-reload.
"""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# Step 1: Get current model for Alin
print('=== Step 1: Current state ===')
out, _ = run('curl -s http://127.0.0.1:8080/api/bots')
bots = json.loads(out)
print(f'  Alin model: {bots["alin"]["model"]}')

# Step 2: Switch Alin to codesome
print('\n=== Step 2: Switch Alin to codesome/claude-opus-4-6 ===')
out, _ = run("""curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/model -H 'Content-Type: application/json' -d '{"model":"codesome/claude-opus-4-6"}'""")
print(f'  API response: {out.strip()}')

# Step 3: Wait a moment for OpenClaw to detect file change
time.sleep(3)

# Step 4: Check OpenClaw logs for hot-reload signal
print('\n=== Step 3: OpenClaw logs (last 30 lines) ===')
out, _ = run('docker logs --tail 30 deploy-openclaw-gateway-1 2>&1')
# Look for reload-related log lines
for line in out.strip().split('\n'):
    lower = line.lower()
    if any(k in lower for k in ['reload', 'config', 'model', 'watch', 'changed', 'primary', 'updated', 'openclaw.json']):
        print(f'  >> {line.strip()}')
    elif 'error' in lower or 'warn' in lower:
        print(f'  !! {line.strip()}')

# Also print last few lines for context
print('\n=== Last 10 log lines ===')
for line in out.strip().split('\n')[-10:]:
    print(f'  {line.strip()}')

# Step 5: Switch back
print('\n=== Step 4: Switch Alin back to antigravity/gemini-3-flash ===')
out, _ = run("""curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/model -H 'Content-Type: application/json' -d '{"model":"antigravity/gemini-3-flash"}'""")
print(f'  API response: {out.strip()}')

# Final check
time.sleep(1)
out, _ = run('curl -s http://127.0.0.1:8080/api/bots')
bots = json.loads(out)
for bid, b in bots.items():
    print(f'  {b["name"]}: {b["model"]}')

# Check Gateway V2 logs
print('\n=== Gateway V2 logs ===')
out, _ = run('tail -20 /tmp/llm-gateway-v2.stdout.log')
print(out.strip())

client.close()
print('\nVerification complete!')
