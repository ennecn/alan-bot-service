#!/usr/bin/env python3
"""Deep dive into skill loading mechanism"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Full openclaw.json
    ("openclaw.json (full)", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null"),

    # Check agents section for skill references
    ("agents config", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq '.agents' 2>/dev/null"),

    # Check tools section
    ("tools config", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq '.tools' 2>/dev/null"),

    # Check if there's a skills.json or similar
    ("skills.json", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/skills.json 2>/dev/null || echo 'not found'"),

    # Check how image-gen skill is referenced (it works, so it's a good reference)
    ("image-gen skill files", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/skills/image-gen/ 2>/dev/null"),
    ("image-gen _meta.json", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/skills/image-gen/_meta.json 2>/dev/null"),

    # Search for skill loading in the app code
    ("skill loader code", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -r 'loadSkill\\|skill.*load\\|SKILL.md' /app/node_modules/.pnpm/@mariozechner+pi-ai@*/node_modules/@mariozechner/pi-ai/dist/ 2>/dev/null | head -20"),

    # Check if skills are in the system prompt
    ("system prompt skill refs", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -r 'skills' /app/node_modules/.pnpm/@mariozechner+pi-ai@*/node_modules/@mariozechner/pi-ai/dist/ 2>/dev/null | grep -i 'skill' | head -10"),
]

for label, cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err or "(empty)"
    if len(result) > 3000:
        result = result[:3000] + "\n... (truncated)"
    print(f"=== {label} ===")
    print(result)
    print()

client.close()
