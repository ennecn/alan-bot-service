#!/usr/bin/env python3
"""Check if claude-code skill was registered and available commands"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Search for claude-code in startup logs
    ("claude-code in logs", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep 'claude.code\\|claude-code\\|cc-bridge\\|cc_bridge' /tmp/openclaw/openclaw-2026-02-10.log 2>/dev/null | head -10"),

    # Get ALL skill registrations from startup
    ("all skill registrations", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep 'Sanitized skill command' /tmp/openclaw/openclaw-2026-02-10.log 2>/dev/null | python3 -c \"import sys,json; [print(json.loads(l)['1']['sanitized']) for l in sys.stdin]\" 2>/dev/null"),

    # Check if skills are re-read on each conversation
    ("skill file watch", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'watch\\|chokidar\\|fs.watch\\|inotify\\|readFile.*SKILL' /app/dist/skills-CmU0Q92f.js 2>/dev/null | head -10"),

    # Check how skill content is loaded (cached or fresh)
    ("skill content loading", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'readFile\\|readSync\\|SKILL.md' /app/dist/skills-CmU0Q92f.js 2>/dev/null | head -20"),

    # Check today's log for any skill activity
    ("today skill log", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /tmp/openclaw/openclaw-2026-02-11.log 2>/dev/null | grep -i 'skill' | head -20"),

    # Check if there's a way to list registered commands
    ("registered commands", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'registerCommand\\|addCommand\\|commandMap\\|commandRegistry' /app/dist/skills-CmU0Q92f.js 2>/dev/null | head -10"),
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
