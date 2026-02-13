#!/usr/bin/env python3
"""Check Claude Code task output from the live test."""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

print('=== task-output.txt ===', flush=True)
out, _ = run('cat /Users/fangjin/claude-workspace/alin/task-output.txt 2>&1')
print(out[:2000], flush=True)

print('\n=== latest.json ===', flush=True)
out, _ = run('cat /Users/fangjin/claude-code-results/latest.json 2>&1')
print(out[:2000], flush=True)

print('\n=== task-meta.json ===', flush=True)
out, _ = run('cat /Users/fangjin/claude-workspace/alin/task-meta.json 2>&1')
print(out[:2000], flush=True)

print('\n=== Check if claude process is still running ===', flush=True)
out, _ = run('ps aux | grep "claude -p" | grep -v grep 2>&1')
print(out[:500] if out.strip() else '(no claude process running)', flush=True)

print('\n=== Check files in workspace ===', flush=True)
out, _ = run('ls -la /Users/fangjin/claude-workspace/alin/ 2>&1')
print(out[:1000], flush=True)

c.close()
