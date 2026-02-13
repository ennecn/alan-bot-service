import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Upload fixed cc-bridge.js
print("=== Uploading fixed cc-bridge.js ===")
sftp = mac.open_sftp()
with open(r'd:\openclawVPS\cc-bridge\cc-bridge.js', 'r', encoding='utf-8') as f:
    content = f.read()
with sftp.open('/Users/fangjin/cc-bridge/cc-bridge.js', 'w') as f:
    f.write(content)
sftp.close()
print("  [OK]")

# Restart Bridge
print("\n=== Restarting Bridge ===")
out, _ = run(f'{PATH_PREFIX} && lsof -i :9090 -t 2>/dev/null')
if out:
    run(f'kill {out}')
    time.sleep(1)

run(
    f'{PATH_PREFIX} && cd /Users/fangjin/cc-bridge && '
    f'ANTHROPIC_API_KEY="sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8" '
    f'ANTHROPIC_BASE_URL="https://v3.codesome.cn" '
    f'nohup /opt/homebrew/bin/node cc-bridge.js > /tmp/cc-bridge.log 2>&1 & echo $!'
)
time.sleep(3)

out, _ = run('curl -s http://127.0.0.1:9090/health')
print(f"  Health: {out}")

# Test from Alin container
print("\n=== Test: Send task from Alin container ===")
test_body = json.dumps({
    "session_id": "test-llm-gateway",
    "message": "List the files in the current directory. Tell me the project name and what it does in 2 sentences.",
    "working_directory": "/Users/fangjin/llm-gateway"
})

out, _ = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' "
    f"--max-time 90 2>&1",
    timeout=120
)
print("Response events:")
for line in out.split('\n'):
    if line.startswith('event:') or line.startswith('data:'):
        data = line
        if len(data) > 200:
            data = data[:200] + '...'
        print(f"  {data}")

# Check sessions
print("\n=== Sessions ===")
out, _ = run('curl -s http://127.0.0.1:9090/api/sessions')
print(out[:500])

# Follow-up test
print("\n=== Follow-up (context test) ===")
followup = json.dumps({
    "session_id": "test-llm-gateway",
    "message": "What port does the server listen on? Answer based on what you already know from reading the files."
})
out, _ = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{followup}' "
    f"--max-time 90 2>&1",
    timeout=120
)
print("Follow-up events:")
for line in out.split('\n'):
    if line.startswith('data:') and '"text"' in line:
        data = line
        if len(data) > 300:
            data = data[:300] + '...'
        print(f"  {data}")

# Logs
print("\n=== Bridge logs ===")
out, _ = run('tail -15 /tmp/cc-bridge.log')
print(out)

mac.close()
print("\n[DONE]")
