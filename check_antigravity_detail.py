import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', port=2222, username='root', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# ============================================================
# 1. Docker containers overview
# ============================================================
print("=" * 60)
print("1. Docker containers")
print("=" * 60)
out, _ = run('docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"')
print(out)

# ============================================================
# 2. Antigravity container details
# ============================================================
print("\n" + "=" * 60)
print("2. Antigravity container details")
print("=" * 60)
out, _ = run('docker inspect antigravity-manager --format "Image: {{.Config.Image}}\nCreated: {{.Created}}\nRestartCount: {{.RestartCount}}\nStatus: {{.State.Status}}\nStartedAt: {{.State.StartedAt}}"')
print(out)

out, _ = run('docker inspect antigravity-manager --format \'{{json .Config.Env}}\' | python3 -m json.tool 2>/dev/null')
print(f"\nEnvironment:\n{out}")

out, _ = run('docker inspect antigravity-manager --format \'{{json .HostConfig.Binds}}\'')
print(f"\nVolumes: {out}")

# ============================================================
# 3. Resource usage
# ============================================================
print("\n" + "=" * 60)
print("3. Resource usage")
print("=" * 60)
out, _ = run('docker stats antigravity-manager --no-stream --format "CPU: {{.CPUPerc}}  MEM: {{.MemUsage}}  NET: {{.NetIO}}"')
print(out)

# ============================================================
# 4. Recent logs
# ============================================================
print("\n" + "=" * 60)
print("4. Antigravity recent logs (last 30 lines)")
print("=" * 60)
out, _ = run('docker logs antigravity-manager --tail 30 2>&1')
print(out)

# ============================================================
# 5. Model list and quota check
# ============================================================
print("\n" + "=" * 60)
print("5. Available models")
print("=" * 60)
out, _ = run('curl -s http://127.0.0.1:8045/v1/models -H "Authorization: Bearer sk-antigravity-openclaw" --max-time 10')
try:
    models = json.loads(out)
    for m in models.get('data', []):
        print(f"  {m['id']}")
    print(f"\n  Total: {len(models.get('data', []))} models")
except:
    print(out[:2000])

# ============================================================
# 6. Functional test - Gemini 3 Flash
# ============================================================
print("\n" + "=" * 60)
print("6. Functional test - Gemini 3 Flash (streaming)")
print("=" * 60)
test_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Please respond with exactly: Antigravity health check OK"}],
    "max_tokens": 50,
    "stream": False
})
out, _ = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer sk-antigravity-openclaw' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
try:
    resp = json.loads(out)
    content = resp['choices'][0]['message']['content']
    usage = resp.get('usage', {})
    print(f"  Model: {resp.get('model')}")
    print(f"  Response: {content}")
    print(f"  Usage: prompt={usage.get('prompt_tokens')}, completion={usage.get('completion_tokens')}, total={usage.get('total_tokens')}")
    print(f"  Finish reason: {resp['choices'][0].get('finish_reason')}")
except:
    print(out[:1000])

# ============================================================
# 7. Antigravity Web UI / dashboard check
# ============================================================
print("\n" + "=" * 60)
print("7. Antigravity management ports")
print("=" * 60)
out, _ = run('docker inspect antigravity-manager --format \'{{json .NetworkSettings.Ports}}\'')
print(f"  Port mappings: {out}")

# Check if there's a web dashboard
out, _ = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8045/ --max-time 5')
print(f"  Root endpoint HTTP: {out}")

# ============================================================
# 8. Anthropic-proxy (port 8047) status
# ============================================================
print("\n" + "=" * 60)
print("8. Anthropic-proxy (port 8047) - protocol translator")
print("=" * 60)
out, _ = run('ps aux | grep anthropic-proxy | grep -v grep')
print(f"  Process: {out if out else 'NOT RUNNING'}")

out, _ = run('cat /root/anthropic-proxy.js | wc -l')
print(f"  Script lines: {out}")

# Test Anthropic format through proxy
test_anthro = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Say: proxy OK"}],
    "max_tokens": 30
})
out, _ = run(
    f"curl -s http://127.0.0.1:8047/v1/messages "
    f"-H 'x-api-key: sk-antigravity-openclaw' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_anthro}' --max-time 30"
)
try:
    resp = json.loads(out)
    content = resp.get('content', [{}])[0].get('text', '')
    print(f"  Anthropic proxy response: {content}")
    print(f"  Stop reason: {resp.get('stop_reason')}")
except:
    print(f"  Raw: {out[:500]}")

# ============================================================
# 9. System resources
# ============================================================
print("\n" + "=" * 60)
print("9. VPS system resources")
print("=" * 60)
out, _ = run('free -h | head -3')
print(f"  Memory:\n{out}")
out, _ = run('df -h / | tail -1')
print(f"  Disk: {out}")
out, _ = run('uptime')
print(f"  Uptime: {out}")

vps.close()
print("\n[DONE] Antigravity detailed health check complete.")
