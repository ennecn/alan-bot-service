#!/usr/bin/env python3
"""Inspect Antigravity reverse proxy code structure"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', port=2222, username='root', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# 1. Container info
print("=" * 60)
print("1. Container Info")
print("=" * 60)
out, _ = run('docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" | grep -i antigravity')
print(out)

# 2. Entrypoint
print("\n" + "=" * 60)
print("2. Container Entrypoint/Cmd")
print("=" * 60)
out, _ = run('docker inspect antigravity-manager --format "Entrypoint: {{.Config.Entrypoint}}\nCmd: {{.Config.Cmd}}\nWorkingDir: {{.Config.WorkingDir}}"')
print(out)

# 3. Image info
print("\n" + "=" * 60)
print("3. Image Details")
print("=" * 60)
out, _ = run('docker inspect antigravity-manager --format "Image: {{.Config.Image}}"')
print(out)
out, _ = run('docker image inspect $(docker inspect antigravity-manager --format "{{.Image}}") --format "Size: {{.Size}}\nCreated: {{.Created}}\nArch: {{.Architecture}}" 2>/dev/null')
print(out)

# 4. Process inside container
print("\n" + "=" * 60)
print("4. Running Process")
print("=" * 60)
out, _ = run('docker exec antigravity-manager cat /proc/1/cmdline 2>/dev/null | tr "\\0" " "')
print(f"PID 1 cmdline: {out}")
out, err = run('docker exec antigravity-manager ps aux 2>/dev/null')
print(out if out else f"ps not available: {err}")

# 5. Filesystem structure
print("\n" + "=" * 60)
print("5. Container Filesystem")
print("=" * 60)
for d in ['/app', '/opt', '/usr/local/bin', '/home']:
    out, _ = run(f'docker exec antigravity-manager ls -la {d} 2>/dev/null')
    if out:
        print(f"\n--- {d} ---")
        print(out)

# 6. Check if it's a binary (Go/Rust) or script (Node/Python)
print("\n" + "=" * 60)
print("6. Binary Type Detection")
print("=" * 60)
out, _ = run('docker exec antigravity-manager file /proc/1/exe 2>/dev/null')
print(f"PID 1 binary: {out}")
out, _ = run('docker exec antigravity-manager which node python python3 2>/dev/null')
print(f"Interpreters: {out}")

# 7. Check for source code / config files
print("\n" + "=" * 60)
print("7. Source Code / Config")
print("=" * 60)
out, _ = run('docker exec antigravity-manager find / -maxdepth 3 -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.toml" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" -o -name "*.conf" 2>/dev/null | grep -v proc | grep -v sys | head -50')
print(out if out else "No source files found")

# 8. Check volumes/mounts
print("\n" + "=" * 60)
print("8. Volumes / Mounts")
print("=" * 60)
out, _ = run("docker inspect antigravity-manager --format '{{json .Mounts}}'")
print(out)

# 9. Check environment variables (relevant ones)
print("\n" + "=" * 60)
print("9. Key Environment Variables")
print("=" * 60)
out, _ = run("docker inspect antigravity-manager --format '{{json .Config.Env}}' | python3 -c \"import json,sys; [print(e) for e in json.load(sys.stdin) if any(k in e.upper() for k in ['MODEL','API','KEY','PORT','HOST','URL','PROXY','GEMINI','THOUGHT'])]\" 2>/dev/null")
print(out if out else "(none matching)")

# 10. Recent logs (look for tool-related messages)
print("\n" + "=" * 60)
print("10. Recent Logs (last 50 lines)")
print("=" * 60)
out, _ = run('docker logs antigravity-manager --tail 50 2>&1')
print(out[:3000])

vps.close()
print("\n[DONE]")
