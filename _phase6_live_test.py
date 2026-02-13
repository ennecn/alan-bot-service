#!/usr/bin/env python3
"""Phase 6 Live Test: Dispatch a real task to Claude Code and verify the full pipeline."""
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
print('  Phase 6: LIVE End-to-End Test', flush=True)
print('='*60, flush=True)

# ============================================================
# Step 1: Clear old results
# ============================================================
print('\n[1] Clearing old results...', flush=True)
run('rm -f /Users/fangjin/claude-code-results/latest.json')
run('rm -f /Users/fangjin/claude-workspace/alin/task-meta.json /Users/fangjin/claude-workspace/alin/task-output.txt')

# ============================================================
# Step 2: Dispatch a simple task
# ============================================================
print('[2] Dispatching task to Claude Code...', flush=True)
prompt = 'Create a file called hello.txt containing the text "Hello from Claude Code E2E test" in the current directory. Then print "TASK_DONE" to stdout.'
dispatch_cmd = f'''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke \
  --node MacMini \
  --command system.run \
  --params '{json.dumps({"command":["bash","/Users/fangjin/claude-code-dispatch.sh","-p", prompt, "-n", "e2e-test", "-w", "/Users/fangjin/claude-workspace/alin"]})}' \
  --invoke-timeout 15000 --json 2>&1'''

out, _ = run(dispatch_cmd, timeout=20)
try:
    result = json.loads(out.strip())
    dispatch_out = result.get('payload', {}).get('stdout', '')
    print(f'  Dispatch response: {dispatch_out.strip()[:300]}', flush=True)
    dispatch_ok = 'dispatched' in dispatch_out.lower() or 'task' in dispatch_out.lower()
    print(f'  [{"PASS" if dispatch_ok else "WARN"}] Task dispatched', flush=True)
except Exception as e:
    print(f'  Dispatch raw: {out.strip()[:300]}', flush=True)
    dispatch_ok = False

# ============================================================
# Step 3: Wait for Claude Code to complete
# ============================================================
print('\n[3] Waiting for Claude Code to complete...', flush=True)
print('  (Polling task-output.txt and latest.json every 10s, max 180s)', flush=True)

max_wait = 180
elapsed = 0
task_done = False
hook_fired = False

while elapsed < max_wait:
    time.sleep(10)
    elapsed += 10
    
    # Check if task-output.txt has content
    out, _ = run('wc -l /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null || echo "0"', timeout=5)
    lines = out.strip().split()[0] if out.strip() else '0'
    
    # Check if latest.json exists (hook fired)
    hook_out, _ = run('cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null || echo "NOT_FOUND"', timeout=5)
    
    if 'NOT_FOUND' not in hook_out and hook_out.strip():
        hook_fired = True
    
    # Check if hello.txt was created
    hello_out, _ = run('cat /Users/fangjin/claude-workspace/alin/hello.txt 2>/dev/null || echo "NOT_FOUND"', timeout=5)
    hello_exists = 'NOT_FOUND' not in hello_out
    
    status = f'{elapsed}s: output_lines={lines}'
    if hello_exists:
        status += f', hello.txt=YES'
        task_done = True
    if hook_fired:
        status += f', hook=FIRED'
    
    print(f'  {status}', flush=True)
    
    if task_done and hook_fired:
        print('  Task completed and hook fired!', flush=True)
        break
    
    if task_done and elapsed >= 60:
        print('  Task done but hook not fired after 60s. Continuing...', flush=True)

# ============================================================
# Step 4: Verify results
# ============================================================
print('\n[4] Verifying results...', flush=True)

# Check hello.txt
hello_out, _ = run('cat /Users/fangjin/claude-workspace/alin/hello.txt 2>/dev/null || echo "NOT_FOUND"', timeout=5)
hello_ok = 'Hello from Claude Code' in hello_out
print(f'  [{"PASS" if hello_ok else "FAIL"}] hello.txt: {hello_out.strip()[:100]}', flush=True)

# Check task-output.txt
output_out, _ = run('head -20 /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null || echo "EMPTY"', timeout=5)
output_ok = len(output_out.strip()) > 10 and 'EMPTY' not in output_out
print(f'  [{"PASS" if output_ok else "FAIL"}] task-output.txt has content: {len(output_out)} chars', flush=True)

# Check latest.json (hook result)
hook_out, _ = run('cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null || echo "NOT_FOUND"', timeout=5)
if 'NOT_FOUND' not in hook_out:
    try:
        latest = json.loads(hook_out)
        print(f'  [PASS] latest.json: task_name={latest.get("task_name")}, status={latest.get("status")}', flush=True)
        hook_ok = True
    except:
        print(f'  [WARN] latest.json not valid JSON: {hook_out.strip()[:200]}', flush=True)
        hook_ok = False
else:
    print(f'  [FAIL] latest.json not found (hook did not fire)', flush=True)
    hook_ok = False

# Check task-meta.json
meta_out, _ = run('cat /Users/fangjin/claude-workspace/alin/task-meta.json 2>/dev/null || echo "NOT_FOUND"', timeout=5)
if 'NOT_FOUND' not in meta_out:
    try:
        meta = json.loads(meta_out)
        print(f'  [PASS] task-meta.json: name={meta.get("task_name")}, prompt={meta.get("prompt","")[:50]}...', flush=True)
    except:
        print(f'  [WARN] task-meta.json: {meta_out.strip()[:100]}', flush=True)

# ============================================================
# Summary
# ============================================================
print('\n' + '='*60, flush=True)
results = [hello_ok, output_ok, hook_ok]
passed = sum(results)
total = len(results)
print(f'  Live Test Results: {passed}/{total} core checks passed', flush=True)
if passed == total:
    print('  FULL PIPELINE VERIFIED! Dispatch -> Claude Code -> Hook -> Results', flush=True)
elif hello_ok and output_ok:
    print('  Task executed OK. Hook notification may need manual check.', flush=True)
else:
    print(f'  {total - passed} check(s) failed. See details above.', flush=True)
print('='*60, flush=True)

# Cleanup
run('rm -f /Users/fangjin/claude-workspace/alin/hello.txt', timeout=5)

c.close()
print('\nLive test complete!', flush=True)
