#!/usr/bin/env python3
"""Patch models.generated.js to redirect gemini-3-flash to Antigravity,
and set OPENAI_API_KEY for the openai-completions provider."""
import paramiko
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'
P = 'export PATH=/usr/local/bin:/usr/bin:/bin'
MODELS_JS = '/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/models.generated.js'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

# Step 1: Patch models.generated.js - change gemini-3-flash-preview baseUrl and headers
# Use sed to replace the baseUrl and remove GitHub-specific headers
patch_script = r"""
import re

path = "%s"
with open(path, 'r') as f:
    content = f.read()

# Find and replace the gemini-3-flash-preview entry
old = '"gemini-3-flash-preview": {\n            id: "gemini-3-flash-preview",\n            name: "Gemini 3 Flash",\n            api: "openai-completions",\n            provider: "github-copilot",\n            baseUrl: "https://api.individual.githubcopilot.com",\n            headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" },'

new = '"gemini-3-flash-preview": {\n            id: "gemini-3-flash",\n            name: "Gemini 3 Flash",\n            api: "openai-completions",\n            provider: "antigravity",\n            baseUrl: "http://138.68.44.141:8045/v1",\n            headers: {},'

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("PATCHED: gemini-3-flash-preview -> Antigravity")
else:
    # Try a more flexible match
    # Check if already patched
    if '138.68.44.141:8045' in content and 'gemini-3-flash' in content:
        print("ALREADY PATCHED")
    else:
        print("PATTERN NOT FOUND - manual check needed")
        # Show the actual content around gemini-3-flash-preview
        idx = content.find('gemini-3-flash-preview')
        if idx >= 0:
            print("Found at index", idx)
            print("Context:", repr(content[idx:idx+500]))
        else:
            print("gemini-3-flash-preview not found in file at all")
""" % MODELS_JS

# Write patch script to container and execute
cmd = f"""{P} && docker exec {CONTAINER} sh -c 'cat > /tmp/patch_gemini.py << "PYEOF"
{patch_script}
PYEOF
python3 /tmp/patch_gemini.py'"""

_, o, e = client.exec_command(cmd)
print("Patch result:", o.read().decode('utf-8', errors='replace'))
err = e.read().decode('utf-8', errors='replace')
if err:
    print("Errors:", err)

# Step 2: Check start.sh for env var setup
_, o, e = client.exec_command(f'cat /Users/fangjin/Desktop/p/docker-openclawd/deploy/start.sh')
start_sh = o.read().decode('utf-8', errors='replace')
print("\n=== Current start.sh ===")
print(start_sh)

client.close()
