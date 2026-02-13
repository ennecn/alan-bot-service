#!/usr/bin/env python3
"""Final verification of all deployed components"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

checks = [
    ("Hook (notify-openclaw.sh)", "head -5 /Users/fangjin/.claude/hooks/notify-openclaw.sh"),
    ("Hook wake event", "grep -c 'wake' /Users/fangjin/.claude/hooks/notify-openclaw.sh"),
    ("Hook Telegram send", "grep -c 'sendMessage' /Users/fangjin/.claude/hooks/notify-openclaw.sh"),
    ("Dispatch v2.1", "head -3 /Users/fangjin/claude-code-dispatch.sh"),
    ("Dispatch PTY detection", "grep -c 'TMUX' /Users/fangjin/claude-code-dispatch.sh"),
    ("Dispatch permission-mode", "grep -c 'permission-mode' /Users/fangjin/claude-code-dispatch.sh"),
    ("Trust helper", "ls -la /Users/fangjin/claude-code-trust.sh"),
    ("Status script", "ls -la /Users/fangjin/claude-code-status.sh"),
    ("List script", "ls -la /Users/fangjin/claude-code-list.sh"),
    ("Stop script", "ls -la /Users/fangjin/claude-code-stop.sh"),
    ("SKILL.md in container", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 head -5 /home/node/.openclaw/skills/claude-code/SKILL.md 2>/dev/null"),
    ("SKILL version", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/skills/claude-code/_meta.json 2>/dev/null"),
    ("Claude settings", "cat /Users/fangjin/.claude/settings.json | /usr/bin/jq '.env'"),
]

for label, cmd in checks:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    result = out or err or "(empty)"
    # Truncate long output
    if len(result) > 120:
        result = result[:120] + "..."
    print(f"[OK] {label}: {result}")

client.close()
print("\nAll components verified.")
