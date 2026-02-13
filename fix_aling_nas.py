#!/usr/bin/env python3
"""Add NAS mount to Aling's docker-compose and recreate container."""
import paramiko
import sys
import time

def run_cmd(cmd, verbose=True):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if verbose:
        if out:
            print(out)
        if err:
            print(err, file=sys.stderr)
    return out, err

DOCKER = '/usr/local/bin/docker'
COMPOSE_FILE = '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling/docker-compose.yml'
COMPOSE_DIR = '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling'

# Step 1: Add NAS mount to docker-compose.yml
print('Step 1: Adding NAS mount to Aling docker-compose.yml...')
patch_script = f"""
import sys
f = '{COMPOSE_FILE}'
content = open(f).read()
if '/tmp/nas:/mnt/nas' in content:
    print('NAS mount already present, skipping')
    sys.exit(0)
old = '      - ./anthropic.js:/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js:ro'
new = old + '\\n      - /tmp/nas:/mnt/nas'
content = content.replace(old, new)
open(f, 'w').write(content)
print('NAS mount added successfully')
"""

# Write patch script to remote
run_cmd(f"cat > /tmp/patch_aling.py << 'PYEOF'\n{patch_script}\nPYEOF")
run_cmd("python3 /tmp/patch_aling.py")

# Verify
print('\nVerified docker-compose.yml:')
run_cmd(f"cat {COMPOSE_FILE}")

# Step 2: Recreate Aling container
print('\nStep 2: Recreating Aling container with NAS mount...')
run_cmd(f"cd {COMPOSE_DIR} && /usr/local/bin/docker compose up -d --force-recreate 2>&1")

# Wait for startup
print('\nWaiting for Aling to start...')
time.sleep(5)

# Step 3: Verify
print('\nStep 3: Verifying...')
run_cmd(f"{DOCKER} ps --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}' | grep aling")
run_cmd(f"{DOCKER} exec aling-gateway ls /mnt/nas/ 2>/dev/null || echo 'NAS NOT ACCESSIBLE'")

# Step 4: Verify skills survived
print('\nStep 4: Checking skills survived recreate...')
run_cmd(f"{DOCKER} exec aling-gateway ls /home/node/.openclaw/skills/ 2>/dev/null")

# Cleanup
run_cmd("rm -f /tmp/patch_aling.py")
print('\nDone!')
