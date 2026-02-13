#!/usr/bin/env python3
"""Check memory system and find ways to add persistent instructions"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Check memory directory
    ("memory dir", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/memory/ 2>/dev/null"),

    # Check if there's a knowledge base
    ("knowledge dir", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls -la /home/node/.openclaw/knowledge/ 2>/dev/null"),

    # Check workspace for any instruction files
    ("workspace files", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 ls /home/node/.openclaw/workspace/ 2>/dev/null | head -20"),

    # Check for AGENT.md or similar
    ("agent md", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 find /home/node/.openclaw -maxdepth 2 -name '*.md' -not -path '*/skills/*' -not -path '*/workspace/*' -not -path '*/node_modules/*' 2>/dev/null"),

    # Check for character/persona config in the code
    ("character config", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -rn 'character\\|persona\\|identity\\|AGENT.md\\|agent.md\\|instructions.md' /app/dist/agent-_H-0rbHV.js /app/dist/run-main-DrVUUPHV.js 2>/dev/null | head -20"),

    # Check subsystem code for system prompt building
    ("system prompt build", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n 'system.*message\\|systemMessage\\|system_prompt\\|buildPrompt\\|buildSystem' /app/dist/agent-_H-0rbHV.js 2>/dev/null | head -20"),

    # Check if there's a way to add custom instructions via config
    ("custom instructions", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -rn 'customInstructions\\|additionalInstructions\\|appendInstructions\\|prependInstructions' /app/dist/ 2>/dev/null | head -10"),

    # Check the meta section of openclaw.json
    ("meta config", "/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json 2>/dev/null | /usr/bin/jq '.meta' 2>/dev/null"),
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
