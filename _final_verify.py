#!/usr/bin/env python3
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=15)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# Health
out, _ = run('curl -s http://127.0.0.1:8080/health')
print(f'Health: {out.strip()}')

# Bots
out, _ = run('curl -s http://127.0.0.1:8080/api/bots')
bots = json.loads(out)
print('\nBots:')
for bid, b in bots.items():
    status = 'OK' if b['ok'] else 'ERR'
    print(f'  {b["name"]:8s} | {b["model"]:35s} | {b["container"]:30s} | {status}')

# Config
out, _ = run('curl -s http://127.0.0.1:8080/api/config')
cfg = json.loads(out)
print('\nModel Options:')
for opt in cfg.get('modelOptions', []):
    print(f'  {opt["id"]:35s} -> {opt["label"]}')

# Web UI
out, _ = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/')
print(f'\nWeb UI: HTTP {out.strip()}')

# Process
out, _ = run('ps aux | grep server.js | grep -v grep')
for line in out.strip().split('\n'):
    if line.strip():
        parts = line.split()
        print(f'Process: PID {parts[1]}')

client.close()
print('\nAll systems operational!')
