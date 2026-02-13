#!/usr/bin/env python3
"""Check and fix Claude Code authentication for dispatch."""
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

# Check if claude is logged in interactively
print('=== Check claude auth status ===', flush=True)
out, err = run('claude auth status 2>&1')
print(f'  stdout: {out.strip()[:500]}', flush=True)
if err.strip():
    print(f'  stderr: {err.strip()[:500]}', flush=True)

# Check what environment the node runs under
print('\n=== Node environment ===', flush=True)
out, _ = run('launchctl print gui/$(id -u)/ai.openclaw.node 2>&1 | head -30')
print(out[:500], flush=True)

# Check HOME env in node context
print('\n=== HOME via node ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["bash","-c","echo HOME=$HOME; echo USER=$USER; whoami; ls -la ~/.claude/ 2>&1 | head -10"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
try:
    result = json.loads(out.strip())
    print(f'  {result.get("payload", {}).get("stdout", "")[:500]}', flush=True)
except:
    print(f'  raw: {out[:500]}', flush=True)

# Check Claude auth files
print('\n=== Claude auth files ===', flush=True)
out, _ = run('ls -la ~/.claude/auth* 2>&1 || echo "No auth files"')
print(f'  {out.strip()[:500]}', flush=True)

out, _ = run('ls -la ~/.claude/credentials* 2>&1 || echo "No credentials files"')
print(f'  {out.strip()[:500]}', flush=True)

# Check if there's an ANTHROPIC_API_KEY set
print('\n=== Check for API key ===', flush=True)
out, _ = run('echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-(not set)}"')
print(f'  {out.strip()[:200]}', flush=True)

# Check the claude config
print('\n=== Claude config ===', flush=True)
out, _ = run('cat ~/.claude/.credentials.json 2>/dev/null || echo "No .credentials.json"')
print(f'  {out.strip()[:500]}', flush=True)

c.close()
