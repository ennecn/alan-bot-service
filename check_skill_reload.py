#!/usr/bin/env python3
"""Check skill loading, hot-reload, and agent system prompt"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Check if skills are hot-reloaded or cached
    ("skill reload mechanism", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'watch\\|reload\\|refresh\\|rescan' /app/dist/skills-CmU0Q92f.js 2>/dev/null | head -20"),

    # Check how skills are injected into agent context
    ("skill injection", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'system.*prompt\\|inject\\|context.*skill\\|skill.*context' /app/dist/agent-_H-0rbHV.js 2>/dev/null | head -20"),

    # Check if there's a /reload or /skills command
    ("reload command", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'reload\\|refresh.*skill' /app/dist/cli-DD5dW58-.js 2>/dev/null | head -10"),

    # Check openclaw CLI for skill commands
    ("openclaw skills CLI", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 openclaw skills 2>&1 | head -20"),

    # Check openclaw help for reload
    ("openclaw help", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 openclaw --help 2>&1 | grep -i 'skill\\|reload\\|restart'"),

    # Check the log file for skill-related entries
    ("log skill entries", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -i 'skill' /tmp/openclaw/openclaw-2026-02-11.log 2>/dev/null | tail -20"),
    ("log skill entries yesterday", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -i 'skill' /tmp/openclaw/openclaw-2026-02-10.log 2>/dev/null | tail -20"),

    # Container uptime
    ("container uptime", "/usr/local/bin/docker inspect deploy-openclaw-gateway-1 --format '{{.State.StartedAt}}' 2>/dev/null"),
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
