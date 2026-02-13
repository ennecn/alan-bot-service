#!/usr/bin/env python3
"""Find actual pi-ai path and check skill loading mechanism"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Find actual pi-ai dist path
    ("pi-ai path", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 find /app/node_modules/.pnpm -name 'pi-ai' -type d 2>/dev/null | head -5"),

    # Find skill-related code
    ("skill code files", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 find /app -name '*.js' -path '*/dist/*' 2>/dev/null | xargs grep -l 'SKILL.md\\|loadSkill\\|skillDir\\|skills/' 2>/dev/null | head -10"),

    # Search for skill loading in all JS files
    ("skill loading grep", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -r 'SKILL' /app/dist/ 2>/dev/null | head -20"),

    # Check /app/dist for skill references
    ("app dist skill refs", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -rl 'skill' /app/dist/ 2>/dev/null | head -10"),

    # Check if there's a skill registry or manifest
    ("skill manifest", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw -name 'skills.json' -o -name 'skill-registry*' -o -name 'manifest*' 2>/dev/null"),

    # Check the startup logs more thoroughly
    ("startup logs", "/usr/local/bin/docker logs deploy-openclaw-gateway-1 2>&1 | head -100"),

    # Check if cc-bridge directory still exists (maybe cached)
    ("cc-bridge check", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls /home/node/.openclaw/skills/cc-bridge 2>&1"),
]

for label, cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err or "(empty)"
    if len(result) > 2000:
        result = result[:2000] + "\n... (truncated)"
    print(f"=== {label} ===")
    print(result)
    print()

client.close()
