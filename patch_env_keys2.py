#!/usr/bin/env python3
"""Patch env-api-keys.js inside the container using SFTP + docker cp."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'
P = 'export PATH=/usr/local/bin:/usr/bin:/bin'
ENV_KEYS_CONTAINER = '/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/env-api-keys.js'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

# Step 1: Copy file out of container
_, o, e = client.exec_command(f'{P} && docker cp {CONTAINER}:{ENV_KEYS_CONTAINER} /tmp/env-api-keys.js')
o.read()

# Step 2: Read via SFTP
sftp = client.open_sftp()
with sftp.open('/tmp/env-api-keys.js', 'r') as f:
    content = f.read().decode('utf-8')

if 'antigravity' in content:
    print("ALREADY PATCHED")
else:
    old = '    if (provider === "anthropic") {'
    new = '''    if (provider === "antigravity") {
        return "sk-antigravity-openclaw";
    }
    if (provider === "anthropic") {'''

    if old in content:
        content = content.replace(old, new)
        with sftp.open('/tmp/env-api-keys.js', 'w') as f:
            f.write(content)

        # Copy back into container
        _, o, e = client.exec_command(f'{P} && docker cp /tmp/env-api-keys.js {CONTAINER}:{ENV_KEYS_CONTAINER}')
        o.read()
        print("PATCHED OK")
    else:
        print("PATTERN NOT FOUND")

# Verify
_, o, e = client.exec_command(f'{P} && docker exec {CONTAINER} grep -B1 -A3 antigravity {ENV_KEYS_CONTAINER}')
print("\nVerify:")
print(o.read().decode('utf-8', errors='replace'))

sftp.close()
client.close()
