#!/usr/bin/env python3
"""Phase 1: Prepare Mac Mini host environment for OpenClaw Node + Claude Code Hooks."""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

def run(cmd, timeout=60):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# 1. Check if openclaw is already installed
print('=== Step 1: Check openclaw CLI ===')
out, err = run('which openclaw 2>/dev/null && openclaw --version 2>/dev/null || echo "NOT INSTALLED"')
print(f'  {out.strip()}')

if 'NOT INSTALLED' in out:
    print('  Installing openclaw globally...')
    out, err = run('npm install -g openclaw 2>&1', timeout=120)
    # Print last 10 lines
    lines = out.strip().split('\n')
    for line in lines[-10:]:
        print(f'  {line}')
    if err.strip():
        print(f'  stderr: {err.strip()[:200]}')
    # Verify
    out, err = run('which openclaw && openclaw --version 2>/dev/null')
    print(f'  Installed: {out.strip()}')
else:
    print('  Already installed!')

# 2. Create working directories
print('\n=== Step 2: Create directories ===')
dirs = [
    '/Users/fangjin/claude-workspace/alin',
    '/Users/fangjin/claude-code-results',
]
for d in dirs:
    out, err = run(f'mkdir -p {d} && echo "OK: {d}"')
    print(f'  {out.strip()}')

# 3. Check jq
print('\n=== Step 3: Check jq ===')
out, err = run('which jq && jq --version || echo "NOT INSTALLED"')
print(f'  {out.strip()}')

if 'NOT INSTALLED' in out:
    print('  Installing jq via brew...')
    out, err = run('brew install jq 2>&1', timeout=120)
    lines = out.strip().split('\n')
    for line in lines[-5:]:
        print(f'  {line}')
    out, err = run('jq --version')
    print(f'  Installed: {out.strip()}')
else:
    print('  Already installed!')

# 4. Verify Claude Code
print('\n=== Step 4: Verify Claude Code ===')
out, err = run('claude --version 2>&1')
print(f'  Claude Code: {out.strip()}')

# 5. Check Node.js version (needed for openclaw)
print('\n=== Step 5: Node.js version ===')
out, err = run('node --version')
print(f'  Node: {out.strip()}')

# 6. Summary
print('\n=== Summary ===')
out, err = run('which openclaw && which jq && which claude && echo "ALL TOOLS READY"')
if 'ALL TOOLS READY' in out:
    print('  All prerequisites installed!')
else:
    print(f'  Missing tools: {out.strip()}')

client.close()
print('\nPhase 1 complete!')
