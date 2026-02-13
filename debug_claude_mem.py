#!/usr/bin/env python3
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    _, stdout, stderr = client.exec_command(f'bash -l -c {repr(cmd)}')
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Full latest log
out, _ = run('ls -t ~/.claude-mem/logs/ | head -1')
logfile = out.strip()
print(f"=== Log: {logfile} ===")
out, _ = run(f'cat ~/.claude-mem/logs/{logfile}')
print(out[-3000:])

# Try save with verbose output
print("\n=== Save test ===")
out, _ = run('curl -v -X POST http://127.0.0.1:37777/api/memory/save -H "Content-Type: application/json" -d \'{"text":"test123","title":"test","project":"test"}\' 2>&1')
print(out[-1000:])

client.close()
