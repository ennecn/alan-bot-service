import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# 1. Check Gateway is running and on which PID
print("=== Gateway process ===")
print(run('lsof -i :8080 | head -5'))

# 2. Check the patched code is in router.js
print("\n=== Verify patch in router.js ===")
result = run("grep -n 'Sanitized request for Gemini' /Users/fangjin/llm-gateway/router.js")
print(f"  Patch present: {result if result else 'NOT FOUND!'}")

result2 = run("grep -n 'delete proxyBody.thinking' /Users/fangjin/llm-gateway/router.js")
print(f"  Delete thinking: {result2 if result2 else 'NOT FOUND!'}")

# 3. Check recent Gateway logs
print("\n=== Recent Gateway logs ===")
print(run('tail -30 /tmp/gateway.log 2>/dev/null'))

# 4. Check Alin container logs for recent activity
print("\n=== Alin (deploy-openclaw-gateway-1) recent proxy logs ===")
PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
print(run(f'{PATH_PREFIX} && docker logs deploy-openclaw-gateway-1 --tail 20 2>&1 | tail -20'))

# 5. Check if Alin's proxy is actually going through Gateway
print("\n=== Alin api-proxy.js check ===")
print(run(f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 cat /home/node/api-proxy.js | head -10'))

# 6. Check Antigravity logs for recent errors
print("\n=== VPS: Antigravity recent errors ===")
mac.close()

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', username='root', password='YYZZ54321!')

stdin, stdout, stderr = vps.exec_command('docker logs antigravity-manager --tail 20 2>&1 | grep -E "ERROR|effortLevel|Claude Request"')
print(stdout.read().decode('utf-8', errors='replace'))

vps.close()
print("[DONE]")
