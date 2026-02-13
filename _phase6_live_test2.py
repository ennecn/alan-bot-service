#!/usr/bin/env python3
"""Phase 6 Live Test v2: Dispatch a real task to Claude Code after auth fix."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=60):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

print('='*60, flush=True)
print('  Phase 6: LIVE End-to-End Test v2', flush=True)
print('='*60, flush=True)

# Step 1: Clear old results
print('\n[1] Clearing old results...', flush=True)
run('rm -f /Users/fangjin/claude-code-results/latest.json')
run('rm -f /Users/fangjin/claude-workspace/alin/task-meta.json /Users/fangjin/claude-workspace/alin/task-output.txt')
run('rm -f /Users/fangjin/claude-workspace/alin/hello.txt')

# Step 2: Dispatch
print('[2] Dispatching task...', flush=True)
prompt = 'Create a file called hello.txt with the content "Hello from Claude Code E2E test" in the current directory. Then output TASK_DONE.'
dispatch_cmd = f'''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke \
  --node MacMini \
  --command system.run \
  --params '{json.dumps({"command":["bash","/Users/fangjin/claude-code-dispatch.sh","-p", prompt, "-n", "e2e-test-v2", "-w", "/Users/fangjin/claude-workspace/alin"]})}' \
  --invoke-timeout 15000 --json 2>&1'''

out, _ = run(dispatch_cmd, timeout=20)
try:
    result = json.loads(out.strip())
    dispatch_out = result.get('payload', {}).get('stdout', '')
    print(f'  Dispatch: {dispatch_out.strip()[:300]}', flush=True)
except:
    print(f'  Raw: {out.strip()[:300]}', flush=True)

# Step 3: Wait for completion (poll every 10s, max 5 min)
print('\n[3] Waiting for Claude Code...', flush=True)
max_wait = 300
elapsed = 0
task_done = False
hook_fired = False

while elapsed < max_wait:
    time.sleep(10)
    elapsed += 10
    
    # Check hello.txt
    hello_out, _ = run('cat /Users/fangjin/claude-workspace/alin/hello.txt 2>/dev/null || echo "NOT_FOUND"', timeout=5)
    hello_exists = 'NOT_FOUND' not in hello_out
    
    # Check latest.json (hook)
    hook_out, _ = run('cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null || echo "NOT_FOUND"', timeout=5)
    hook_fired = 'NOT_FOUND' not in hook_out and hook_out.strip()
    
    # Check task-output.txt size
    out_lines, _ = run('wc -l /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null || echo "0"', timeout=5)
    lines = out_lines.strip().split()[0] if out_lines.strip() else '0'
    
    # Check if claude still running
    ps_out, _ = run('pgrep -f "claude -p" > /dev/null 2>&1 && echo "RUNNING" || echo "STOPPED"', timeout=5)
    claude_status = ps_out.strip()
    
    status = f'{elapsed}s: claude={claude_status}, output_lines={lines}'
    if hello_exists:
        status += ', hello.txt=FOUND'
        task_done = True
    if hook_fired:
        status += ', hook=FIRED'
    
    print(f'  {status}', flush=True)
    
    if (task_done or claude_status == 'STOPPED') and hook_fired:
        break

# Step 4: Verify
print('\n[4] Results:', flush=True)

# Check hello.txt
hello_out, _ = run('cat /Users/fangjin/claude-workspace/alin/hello.txt 2>/dev/null || echo "NOT_FOUND"', timeout=5)
hello_ok = 'Hello from Claude Code' in hello_out
print(f'  [{"PASS" if hello_ok else "FAIL"}] hello.txt: {hello_out.strip()[:100]}', flush=True)

# Check task-output.txt
output_out, _ = run('cat /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null || echo "EMPTY"', timeout=5)
output_ok = len(output_out.strip()) > 20 and 'EMPTY' not in output_out
# Check if auth error
auth_err = 'Not logged in' in output_out
print(f'  [{"PASS" if output_ok and not auth_err else "FAIL"}] task-output.txt: {len(output_out)} chars{" (AUTH ERROR!)" if auth_err else ""}', flush=True)
if auth_err:
    print(f'    Output: {output_out.strip()[:300]}', flush=True)

# Check latest.json
hook_out, _ = run('cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null || echo "NOT_FOUND"', timeout=5)
if 'NOT_FOUND' not in hook_out:
    try:
        latest = json.loads(hook_out)
        hook_ok = True
        print(f'  [PASS] latest.json: task={latest.get("task_name")}, status={latest.get("status")}', flush=True)
        if latest.get('output'):
            print(f'    output snippet: {latest.get("output","")[:200]}', flush=True)
    except:
        hook_ok = False
        print(f'  [WARN] latest.json parse error: {hook_out[:200]}', flush=True)
else:
    hook_ok = False
    print(f'  [FAIL] latest.json not found', flush=True)

# Summary
print('\n' + '='*60, flush=True)
all_ok = hello_ok and output_ok and not auth_err and hook_ok
if all_ok:
    print('  ALL CHECKS PASSED - FULL PIPELINE VERIFIED!', flush=True)
elif output_ok and not auth_err and hook_ok:
    print('  Pipeline works! hello.txt may have different content.', flush=True)
else:
    print('  Some checks failed. See details above.', flush=True)
print('='*60, flush=True)

c.close()
print('\nDone!', flush=True)
