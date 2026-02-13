import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# ============================================================
# Step 1: Create directory
# ============================================================
print("=== Step 1: Create cc-bridge directory ===")
run('mkdir -p /Users/fangjin/cc-bridge')

# ============================================================
# Step 2: Upload files
# ============================================================
print("=== Step 2: Upload files ===")
sftp = mac.open_sftp()

# Upload cc-bridge.js
with open(r'd:\openclawVPS\cc-bridge\cc-bridge.js', 'r') as f:
    content = f.read()
with sftp.open('/Users/fangjin/cc-bridge/cc-bridge.js', 'w') as f:
    f.write(content)
print("  [OK] cc-bridge.js")

# Upload package.json
with open(r'd:\openclawVPS\cc-bridge\package.json', 'r') as f:
    content = f.read()
with sftp.open('/Users/fangjin/cc-bridge/package.json', 'w') as f:
    f.write(content)
print("  [OK] package.json")

# Upload skill file
with open(r'd:\openclawVPS\cc-bridge\claude-code-bridge.skill.md', 'r', encoding='utf-8') as f:
    content = f.read()
with sftp.open('/Users/fangjin/cc-bridge/claude-code-bridge.skill.md', 'w') as f:
    f.write(content)
print("  [OK] claude-code-bridge.skill.md")

sftp.close()

# ============================================================
# Step 3: Check Claude Code env vars
# ============================================================
print("\n=== Step 3: Check Claude Code environment ===")
out, _ = run('grep ANTHROPIC ~/.zshrc')
print(f"  zshrc: {out}")

# ============================================================
# Step 4: Start the Bridge service
# ============================================================
print("\n=== Step 4: Start cc-bridge ===")

# Kill any existing process on port 9090
out, _ = run(f'{PATH_PREFIX} && lsof -i :9090 -t 2>/dev/null')
if out:
    print(f"  Killing existing process on 9090 (PID: {out})...")
    run(f'kill {out}')
    time.sleep(1)

# Start with env vars from .zshrc
# Claude Code on host uses Codesome directly
out, _ = run(
    f'{PATH_PREFIX} && cd /Users/fangjin/cc-bridge && '
    f'ANTHROPIC_API_KEY="sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8" '
    f'ANTHROPIC_BASE_URL="https://v3.codesome.cn" '
    f'nohup /opt/homebrew/bin/node cc-bridge.js > /tmp/cc-bridge.log 2>&1 & echo $!'
)
print(f"  Started PID: {out}")

time.sleep(3)

# Verify it's running
out, _ = run(f'{PATH_PREFIX} && lsof -i :9090 -t 2>/dev/null')
print(f"  Port 9090 PID: {out}")

out, _ = run('curl -s http://127.0.0.1:9090/health')
print(f"  Health: {out}")

# Check logs
out, _ = run('tail -5 /tmp/cc-bridge.log')
print(f"  Logs:\n{out}")

# ============================================================
# Step 5: Deploy skill to Alin container
# ============================================================
print("\n=== Step 5: Deploy skill to Alin ===")

# Copy skill file into Alin's skills directory
out, _ = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 mkdir -p /home/node/.openclaw/skills/cc-bridge'
)
out, _ = run(
    f'{PATH_PREFIX} && docker cp /Users/fangjin/cc-bridge/claude-code-bridge.skill.md '
    f'deploy-openclaw-gateway-1:/home/node/.openclaw/skills/cc-bridge/SKILL.md'
)
print(f"  Skill deployed: {out if out else 'OK'}")

# Verify
out, _ = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 ls /home/node/.openclaw/skills/cc-bridge/'
)
print(f"  Skill files: {out}")

# Test connectivity from container
out, _ = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f'curl -s http://host.docker.internal:9090/health'
)
print(f"  Container -> Bridge health: {out}")

mac.close()
print("\n[DONE] Bridge deployed and skill installed.")
