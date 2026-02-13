import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ============================================================
# Check Antigravity config on VPS
# ============================================================
print("=== VPS: Antigravity config ===")
vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', username='root', password='YYZZ54321!')

# Check docker container for antigravity
stdin, stdout, stderr = vps.exec_command('docker ps --format "{{.Names}}\\t{{.Image}}\\t{{.Ports}}" 2>/dev/null | grep -i anti')
print("Containers:")
print(stdout.read().decode())

# Check the anthropic-proxy.js on VPS (port 8047) which talks to Antigravity
stdin, stdout, stderr = vps.exec_command('cat /root/anthropic-proxy.js 2>/dev/null | head -50')
proxy_content = stdout.read().decode()
print("\nanthropic-proxy.js (first 50 lines):")
print(proxy_content)

# Check antigravity docker env/config
stdin, stdout, stderr = vps.exec_command('docker inspect $(docker ps -q --filter "publish=8045") --format "{{json .Config.Env}}" 2>/dev/null')
env_out = stdout.read().decode()
print("\nAntigravity container env:")
print(env_out[:2000])

# Try with different auth methods
for auth_header in ['Authorization: Bearer test', 'x-api-key: test']:
    stdin, stdout, stderr = vps.exec_command(
        f'curl -s -w "\\nHTTP:%{{http_code}}" http://127.0.0.1:8045/v1/models -H "{auth_header}" --max-time 5'
    )
    print(f"\nModels with '{auth_header}': {stdout.read().decode()[:500]}")

vps.close()

# ============================================================
# Check Gateway Antigravity provider details
# ============================================================
print("\n=== Mac Mini: Gateway Antigravity provider ===")
mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Get full provider details
stdin, stdout, stderr = mac.exec_command('curl -s http://127.0.0.1:8080/api/providers 2>/dev/null')
providers = json.loads(stdout.read().decode())
for p in providers:
    print(f"\n  Provider [{p['id']}] {p['name']}:")
    for k, v in p.items():
        print(f"    {k}: {v}")

# Check the Gateway's fallback.js to see how Antigravity is configured
stdin, stdout, stderr = mac.exec_command('cat /Users/fangjin/llm-gateway/fallback.js 2>/dev/null')
fallback_content = stdout.read().decode()
print("\n\nfallback.js (Antigravity-related):")
for line in fallback_content.split('\n'):
    if 'antigravity' in line.lower() or 'Antigravity' in line or '8045' in line or '8047' in line:
        print(f"  {line}")

# Check router.js for Antigravity handling
stdin, stdout, stderr = mac.exec_command('cat /Users/fangjin/llm-gateway/router.js 2>/dev/null')
router_content = stdout.read().decode()
print("\nrouter.js (Antigravity-related):")
for line in router_content.split('\n'):
    if 'antigravity' in line.lower() or 'Antigravity' in line or '8045' in line or '8047' in line or 'gemini' in line.lower():
        print(f"  {line}")

mac.close()
print("\n[DONE]")
