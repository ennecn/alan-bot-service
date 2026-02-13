#!/usr/bin/env python3
"""Phase 2: Explore node pairing methods."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

def get_client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=10)
    return c

def run(client, cmd, timeout=30):
    _, stdout, stderr = client.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

c = get_client()

# Check all node-related help and configs
print('=== openclaw node install --help ===', flush=True)
out, _ = run(c, 'openclaw node install --help 2>&1')
print(out.strip(), flush=True)

print('\n=== openclaw nodes --help (gateway CLI) ===', flush=True)
out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes --help 2>&1')
print(out.strip()[:1000], flush=True)

print('\n=== openclaw nodes add --help ===', flush=True)
out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes add --help 2>&1')
print(out.strip()[:500], flush=True)

print('\n=== Check existing node configs ===', flush=True)
out, _ = run(c, 'ls -la /Users/fangjin/.openclaw/ 2>&1')
print(out.strip(), flush=True)

out, _ = run(c, 'cat /Users/fangjin/.openclaw/node.json 2>/dev/null || echo "NOT FOUND"')
print(f'\nnode.json: {out.strip()[:500]}', flush=True)

out, _ = run(c, 'cat /Users/fangjin/.openclaw/config.json 2>/dev/null || echo "NOT FOUND"')
print(f'\nconfig.json: {out.strip()[:500]}', flush=True)

print('\n=== Gateway config (docker) ===', flush=True)
out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/config.json 2>/dev/null || echo "NOT FOUND"')
print(f'{out.strip()[:500]}', flush=True)

print('\n=== Gateway nodes config ===', flush=True)
out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 npx openclaw config get gateway.nodes 2>&1')
print(f'{out.strip()[:500]}', flush=True)

print('\n=== Try: openclaw nodes pair --help (gateway) ===', flush=True)
out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes pair --help 2>&1')
print(out.strip()[:500], flush=True)

print('\n=== Try: generate pairing token from gateway ===', flush=True)
out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes token 2>&1')
print(f'token: {out.strip()[:500]}', flush=True)

out, _ = run(c, 'docker exec deploy-openclaw-gateway-1 npx openclaw nodes generate-token 2>&1')
print(f'generate-token: {out.strip()[:500]}', flush=True)

# Check the gateway docker-compose
print('\n=== Docker compose for gateway ===', flush=True)
out, _ = run(c, 'cat /Users/fangjin/Desktop/p/docker-openclawd/deploy/docker-compose.yml 2>&1')
print(out.strip()[:1500], flush=True)

c.close()
print('\nDone!', flush=True)
