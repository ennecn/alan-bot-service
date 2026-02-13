#!/usr/bin/env python3
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=15)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# Read Alin's config as reference
out, _ = run('docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
config = json.loads(out)

# Show agents.defaults section
defaults = config.get('agents', {}).get('defaults', {})
print('=== agents.defaults keys ===')
print(json.dumps(list(defaults.keys()), indent=2))

print('\n=== Full agents.defaults (without models whitelist for brevity) ===')
show = {k: v for k, v in defaults.items()}
print(json.dumps(show, indent=2, ensure_ascii=False))

print('\n=== Has memorySearch? ===')
print('memorySearch' in defaults)

client.close()
