#!/usr/bin/env python3
"""Check openclaw.json for system prompt / persona / instructions config"""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Full agents config
    ("agents config", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq '.agents' 2>/dev/null"),

    # Check for persona/instructions/system prompt fields in code
    ("persona fields", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'persona\\|instructions\\|systemPrompt\\|system_prompt\\|customPrompt\\|agentPrompt' /app/dist/agent-_H-0rbHV.js 2>/dev/null | head -20"),

    # Check for persona in config schema
    ("config schema persona", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -rn 'persona\\|instructions\\|systemPrompt' /app/dist/configure-ChnTy7Jz.js 2>/dev/null | head -20"),

    # Check for persona in run-main
    ("run-main persona", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'persona\\|instructions\\|systemPrompt\\|appendPrompt' /app/dist/run-main-DrVUUPHV.js 2>/dev/null | head -20"),

    # Check if there's a persona.md or instructions file
    ("persona files", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw -name 'persona*' -o -name 'instructions*' -o -name 'system-prompt*' -o -name 'AGENT.md' 2>/dev/null"),

    # Check the full models config (might have per-model instructions)
    ("models config", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq '.models' 2>/dev/null"),
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
