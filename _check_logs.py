#!/usr/bin/env python3
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

print('=== Gateway V2 stdout ===')
out, _ = run('cat /tmp/llm-gateway-v2.stdout.log')
print(out.strip() if out.strip() else '(empty)')

print('\n=== Gateway V2 stderr ===')
out, _ = run('cat /tmp/llm-gateway-v2.stderr.log')
print(out.strip() if out.strip() else '(empty)')

# Also check gateway process
print('\n=== Process info ===')
out, _ = run('ps aux | grep server.js | grep -v grep')
print(out.strip())

client.close()
