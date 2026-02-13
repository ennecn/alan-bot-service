#!/usr/bin/env python3
"""Inspect OpenClaw Docker deployments on Mac Mini"""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# 1. Docker deployments
print("=" * 60)
print("1. OpenClaw Docker Deployments")
print("=" * 60)
out, _ = run('ls -la ~/Desktop/p/docker-openclawd/')
print(out)

# 2. Each deploy's .env
for name in ['deploy', 'deploy-lain', 'deploy-lumi', 'deploy-aling']:
    print(f"\n--- {name}/.env ---")
    out, _ = run(f'cat ~/Desktop/p/docker-openclawd/{name}/.env 2>/dev/null')
    print(out[:2000] if out else "(not found)")

# 3. Each deploy's docker-compose or config
for name in ['deploy', 'deploy-lain', 'deploy-lumi', 'deploy-aling']:
    print(f"\n--- {name}/docker-compose.yml ---")
    out, _ = run(f'cat ~/Desktop/p/docker-openclawd/{name}/docker-compose.yml 2>/dev/null')
    if not out:
        out, _ = run(f'cat ~/Desktop/p/docker-openclawd/{name}/docker-compose.yaml 2>/dev/null')
    print(out[:2000] if out else "(not found)")

# 4. OpenClaw config (openclaw.json or models.json)
for name in ['deploy', 'deploy-lain', 'deploy-lumi', 'deploy-aling']:
    print(f"\n--- {name}/ config files ---")
    out, _ = run(f'ls -la ~/Desktop/p/docker-openclawd/{name}/ 2>/dev/null')
    print(out)
    # Look for openclaw.json, models.json etc.
    out, _ = run(f'find ~/Desktop/p/docker-openclawd/{name} -maxdepth 2 -name "*.json" -o -name "*.toml" 2>/dev/null')
    if out:
        print(f"Config files: {out}")

# 5. Docker containers running
print("\n" + "=" * 60)
print("5. Docker Containers")
print("=" * 60)
out, _ = run('docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null')
print(out if out else "Docker not running or no containers")

# 6. Check the cc-bridge service
print("\n" + "=" * 60)
print("6. CC-Bridge (port 9090)")
print("=" * 60)
out, _ = run('cat ~/cc-bridge/cc-bridge.js 2>/dev/null || find /Users/fangjin -maxdepth 3 -name "cc-bridge.js" 2>/dev/null')
print(out[:2000] if out else "Not found")

# 7. Check the telegram-proxy
print("\n" + "=" * 60)
print("7. Telegram Proxy")
print("=" * 60)
out, _ = run('ps aux | grep telegram-proxy | grep -v grep')
print(f"Process: {out if out else 'NOT RUNNING'}")
out, _ = run('launchctl list | grep -i telegram')
print(f"launchd: {out if out else 'NOT REGISTERED'}")
out, _ = run('find /Users/fangjin -maxdepth 3 -name "telegram-proxy*" 2>/dev/null')
print(f"Files: {out if out else 'Not found'}")
# Check if port 443 is being used
out, _ = run('sudo lsof -i :443 2>/dev/null | head -5')
print(f"Port 443: {out if out else 'Not listening'}")

# 8. Check the launchd plist for llm-gateway
print("\n" + "=" * 60)
print("8. LLM Gateway launchd config")
print("=" * 60)
out, _ = run('cat ~/Library/LaunchAgents/com.llm-gateway.plist 2>/dev/null')
print(out[:1500] if out else "Not found in LaunchAgents")

# 9. Network config - does Mac Mini go through VPS for anything?
print("\n" + "=" * 60)
print("9. Network / Proxy Config")
print("=" * 60)
out, _ = run('echo $http_proxy; echo $https_proxy; echo $all_proxy')
print(f"Env proxies: {out if out else '(none)'}")
out, _ = run('cat /etc/hosts | grep -v "^#" | grep -v "^$" | head -10')
print(f"hosts file: {out}")

mac.close()
print("\n[DONE]")
