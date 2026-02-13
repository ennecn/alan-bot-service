#!/usr/bin/env python3
"""Test model switching via the new Config Manager API."""
import paramiko, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# 1. Read current state
print('=== Current bot status ===')
out, _ = run('curl -s http://127.0.0.1:8080/api/bots')
bots = json.loads(out)
for bid, b in bots.items():
    print(f'  {b["name"]}: {b["model"]} (ok={b["ok"]})')

# 2. Switch Alin to codesome/claude-opus-4-6
print('\n=== Switching Alin to codesome/claude-opus-4-6 ===')
out, _ = run("""curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/model -H 'Content-Type: application/json' -d '{"model":"codesome/claude-opus-4-6"}'""")
print(f'  Response: {out.strip()}')

# 3. Verify from container
time.sleep(1)
print('\n=== Verify Alin model from container ===')
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
conf = json.loads(out)
model = conf.get('agents', {}).get('defaults', {}).get('model', {}).get('primary', 'NOT SET')
print(f'  openclaw.json model.primary: {model}')

# 4. Re-read from API
out, _ = run('curl -s http://127.0.0.1:8080/api/bots')
bots = json.loads(out)
print(f'  API reports Alin model: {bots["alin"]["model"]}')

# 5. Switch back to antigravity/gemini-3-flash
print('\n=== Switching Alin back to antigravity/gemini-3-flash ===')
out, _ = run("""curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/model -H 'Content-Type: application/json' -d '{"model":"antigravity/gemini-3-flash"}'""")
print(f'  Response: {out.strip()}')

# 6. Test invalid model
print('\n=== Test invalid model ===')
out, _ = run("""curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/model -H 'Content-Type: application/json' -d '{"model":"invalid/model"}'""")
print(f'  Response: {out.strip()}')

# 7. Test invalid bot
print('\n=== Test invalid bot ===')
out, _ = run("""curl -s -X PUT http://127.0.0.1:8080/api/bots/nonexistent/model -H 'Content-Type: application/json' -d '{"model":"antigravity/gemini-3-flash"}'""")
print(f'  Response: {out.strip()}')

# 8. Test /api/config
print('\n=== API Config ===')
out, _ = run('curl -s http://127.0.0.1:8080/api/config')
print(f'  {out.strip()[:300]}')

# 9. Test /api/status
print('\n=== API Status ===')
out, _ = run('curl -s http://127.0.0.1:8080/api/status')
print(f'  {out.strip()[:300]}')

# 10. Test Telegram notification
print('\n=== Telegram Notification ===')
out, _ = run('curl -s -X POST http://127.0.0.1:8080/api/notify-status')
print(f'  {out.strip()}')

client.close()
print('\nAll tests done!')
