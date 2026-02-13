#!/usr/bin/env python3
"""Check 阿凛's skill loading and recent logs"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Check if skill files are visible in container
    ("Skill files", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/skills/claude-code/ 2>/dev/null"),

    # Check SKILL.md first 10 lines (frontmatter)
    ("SKILL.md frontmatter", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 head -10 /home/node/.openclaw/skills/claude-code/SKILL.md 2>/dev/null"),

    # Check container logs for skill loading
    ("Skill load logs", "/usr/local/bin/docker logs deploy-openclaw-gateway-1 2>&1 | grep -i 'skill' | tail -30"),

    # Check container logs for claude-code mentions
    ("Claude-code refs in logs", "/usr/local/bin/docker logs deploy-openclaw-gateway-1 2>&1 | grep -i 'claude-code\\|cc-bridge' | tail -20"),

    # Check recent container logs (last 50 lines)
    ("Recent logs", "/usr/local/bin/docker logs deploy-openclaw-gateway-1 --tail 50 2>&1"),

    # Check openclaw.json for skill config
    ("openclaw.json skills section", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq '.skills // .agents.defaults.skills // \"not found\"' 2>/dev/null"),

    # Check full openclaw.json structure
    ("openclaw.json keys", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq 'keys' 2>/dev/null"),
]

for label, cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err or "(empty)"
    # Truncate very long output
    if len(result) > 2000:
        result = result[:2000] + "\n... (truncated)"
    print(f"=== {label} ===")
    print(result)
    print()

client.close()
