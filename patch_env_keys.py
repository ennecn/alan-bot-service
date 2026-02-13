#!/usr/bin/env python3
"""Patch env-api-keys.js to add antigravity provider API key."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'
P = 'export PATH=/usr/local/bin:/usr/bin:/bin'
ENV_KEYS = '/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/env-api-keys.js'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

py_code = '''
path = "%s"
with open(path, "r") as f:
    content = f.read()

if "antigravity" in content:
    print("ALREADY PATCHED")
else:
    # Add after the anthropic provider check
    old = '    if (provider === "anthropic") {'
    new = '    if (provider === "antigravity") {\\n        return "sk-antigravity-openclaw";\\n    }\\n    if (provider === "anthropic") {'
    if old in content:
        content = content.replace(old, new)
        with open(path, "w") as f:
            f.write(content)
        print("PATCHED OK")
    else:
        print("PATTERN NOT FOUND")
''' % ENV_KEYS

cmd = f"""{P} && docker exec {CONTAINER} python3 -c '{py_code}'"""
_, o, e = client.exec_command(cmd)
print("Result:", o.read().decode('utf-8', errors='replace'))
err = e.read().decode('utf-8', errors='replace')
if err:
    print("Error:", err)

# Verify
_, o, e = client.exec_command(f'{P} && docker exec {CONTAINER} grep -B1 -A3 antigravity {ENV_KEYS}')
print("\nVerify:")
print(o.read().decode('utf-8', errors='replace'))

client.close()
