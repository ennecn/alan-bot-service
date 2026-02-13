#!/usr/bin/env python3
"""Check Claude Code auth files and node env."""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=10):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

# Check auth files directly
print('=== Claude auth files ===', flush=True)
out, _ = run('ls -la /Users/fangjin/.claude/ 2>&1')
print(out[:500], flush=True)

print('=== .credentials.json ===', flush=True)
out, _ = run('cat /Users/fangjin/.claude/.credentials.json 2>/dev/null || echo "NOT_FOUND"')
print(out[:500], flush=True)

print('=== Check for API key in env ===', flush=True)
out, _ = run('cat /Users/fangjin/.zshrc 2>/dev/null | grep -i anthropic || echo "No ANTHROPIC key in .zshrc"')
print(out[:500], flush=True)
out, _ = run('cat /Users/fangjin/.zprofile 2>/dev/null | grep -i anthropic || echo "No ANTHROPIC key in .zprofile"')
print(out[:500], flush=True)
out, _ = run('cat /Users/fangjin/.bash_profile 2>/dev/null | grep -i anthropic || echo "No ANTHROPIC key in .bash_profile"')
print(out[:500], flush=True)

# Check what env the Node process gets
print('\n=== Node process env (via gateway invoke) ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["bash","-c","echo HOME=$HOME; echo USER=$(whoami); ls -la ~/.claude/ 2>&1 | head -15"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
try:
    result = json.loads(out.strip())
    print(result.get('payload', {}).get('stdout', '')[:500], flush=True)
except:
    print(out[:500], flush=True)

# Check what env the dispatch script gets  
print('\n=== Dispatch script env ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["bash","-c","echo HOME=$HOME; env | grep -i claude || echo NO_CLAUDE_ENV; env | grep -i anthrop || echo NO_ANTHROPIC_ENV"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
try:
    result = json.loads(out.strip())
    print(result.get('payload', {}).get('stdout', '')[:500], flush=True)
except:
    print(out[:500], flush=True)

# Check launchd plist for env
print('\n=== Launchd plist env ===', flush=True)
out, _ = run('cat /Users/fangjin/Library/LaunchAgents/ai.openclaw.node.plist 2>&1')
print(out[:1500], flush=True)

c.close()
