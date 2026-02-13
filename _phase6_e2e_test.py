#!/usr/bin/env python3
"""Phase 6: End-to-end testing of the complete pipeline."""
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
print('  Phase 6: End-to-End Testing', flush=True)
print('='*60, flush=True)

# ============================================================
# Test 1: Node connectivity and status
# ============================================================
print('\n=== Test 1: Node connectivity ===', flush=True)
out, _ = run('openclaw node status 2>&1')
status_ok = 'running' in out
print(f'  [{"PASS" if status_ok else "FAIL"}] Node status: {"running" if status_ok else out.strip()[:100]}', flush=True)

out, _ = run('netstat -an | grep "18789.*ESTABLISH"')
conn_ok = 'ESTABLISHED' in out
print(f'  [{"PASS" if conn_ok else "FAIL"}] TCP connection to gateway', flush=True)

# ============================================================
# Test 2: system.run via invoke
# ============================================================
print('\n=== Test 2: system.run ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["echo","E2E test success"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
try:
    result = json.loads(out.strip())
    run_ok = result.get('ok') and 'E2E test success' in result.get('payload', {}).get('stdout', '')
    print(f'  [{"PASS" if run_ok else "FAIL"}] system.run echo: {result.get("payload", {}).get("stdout", "").strip()[:100]}', flush=True)
except:
    print(f'  [FAIL] system.run: {out.strip()[:200]}', flush=True)
    run_ok = False

# ============================================================
# Test 3: Dispatch script accessible
# ============================================================
print('\n=== Test 3: Dispatch script ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["test","-x","/Users/fangjin/claude-code-dispatch.sh"]}' --invoke-timeout 5000 --json 2>&1''', timeout=10)
try:
    result = json.loads(out.strip())
    dispatch_ok = result.get('ok') and result.get('payload', {}).get('exitCode') == 0
    print(f'  [{"PASS" if dispatch_ok else "FAIL"}] Dispatch script is executable', flush=True)
except:
    print(f'  [FAIL] Dispatch script check: {out.strip()[:200]}', flush=True)
    dispatch_ok = False

# ============================================================
# Test 4: Hook script accessible
# ============================================================
print('\n=== Test 4: Hook script ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["test","-x","/Users/fangjin/.claude/hooks/notify-openclaw.sh"]}' --invoke-timeout 5000 --json 2>&1''', timeout=10)
try:
    result = json.loads(out.strip())
    hook_ok = result.get('ok') and result.get('payload', {}).get('exitCode') == 0
    print(f'  [{"PASS" if hook_ok else "FAIL"}] Hook script is executable', flush=True)
except:
    print(f'  [FAIL] Hook script check: {out.strip()[:200]}', flush=True)
    hook_ok = False

# ============================================================
# Test 5: Claude Code settings
# ============================================================
print('\n=== Test 5: Claude Code settings ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["cat","/Users/fangjin/.claude/settings.json"]}' --invoke-timeout 5000 --json 2>&1''', timeout=10)
try:
    result = json.loads(out.strip())
    settings_raw = result.get('payload', {}).get('stdout', '')
    settings = json.loads(settings_raw)
    hooks_ok = 'hooks' in settings and 'Stop' in settings['hooks']
    print(f'  [{"PASS" if hooks_ok else "FAIL"}] Claude Code hooks registered: Stop={len(settings.get("hooks", {}).get("Stop", []))} SessionEnd={len(settings.get("hooks", {}).get("SessionEnd", []))}', flush=True)
except:
    print(f'  [FAIL] Settings check: {out.strip()[:200]}', flush=True)
    hooks_ok = False

# ============================================================
# Test 6: Claude Code CLI available
# ============================================================
print('\n=== Test 6: Claude Code CLI ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["claude","--version"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
try:
    result = json.loads(out.strip())
    claude_version = result.get('payload', {}).get('stdout', '').strip()
    claude_ok = 'Claude Code' in claude_version or '2.' in claude_version
    print(f'  [{"PASS" if claude_ok else "FAIL"}] Claude Code version: {claude_version[:50]}', flush=True)
except:
    print(f'  [FAIL] Claude Code check: {out.strip()[:200]}', flush=True)
    claude_ok = False

# ============================================================
# Test 7: Results directory exists
# ============================================================
print('\n=== Test 7: Results directory ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["test","-d","/Users/fangjin/claude-code-results"]}' --invoke-timeout 5000 --json 2>&1''', timeout=10)
try:
    result = json.loads(out.strip())
    results_ok = result.get('ok') and result.get('payload', {}).get('exitCode') == 0
    print(f'  [{"PASS" if results_ok else "FAIL"}] Results directory exists', flush=True)
except:
    print(f'  [FAIL] Results dir check: {out.strip()[:200]}', flush=True)
    results_ok = False

# ============================================================
# Test 8: Skill installed in gateway
# ============================================================
print('\n=== Test 8: Skill installed ===', flush=True)
out, _ = run('docker exec deploy-openclaw-gateway-1 npx openclaw skills list --json 2>&1')
try:
    # Check if claude-code skill appears in output
    skill_ok = 'claude-code' in out.lower()
    print(f'  [{"PASS" if skill_ok else "FAIL"}] claude-code skill in skills list', flush=True)
except:
    print(f'  [FAIL] Skills check', flush=True)
    skill_ok = False

# ============================================================
# Test 9: Test dispatch script execution (dry test)
# ============================================================
print('\n=== Test 9: Dispatch script dry run ===', flush=True)
out, _ = run('''docker exec deploy-openclaw-gateway-1 npx openclaw nodes invoke --node MacMini --command system.run --params '{"command":["bash","-c","echo test | /Users/fangjin/claude-code-dispatch.sh 2>&1 || echo NEEDS_PROMPT"]}' --invoke-timeout 10000 --json 2>&1''', timeout=15)
try:
    result = json.loads(out.strip())
    dispatch_out = result.get('payload', {}).get('stdout', '')
    dry_ok = 'prompt required' in dispatch_out.lower() or 'error' in dispatch_out.lower()
    print(f'  [{"PASS" if dry_ok else "FAIL"}] Dispatch script responds to missing prompt: {dispatch_out.strip()[:100]}', flush=True)
except:
    print(f'  [FAIL] Dispatch dry run: {out.strip()[:200]}', flush=True)
    dry_ok = False

# ============================================================
# Summary
# ============================================================
print('\n' + '='*60, flush=True)
tests = [status_ok, conn_ok, run_ok, dispatch_ok, hook_ok, hooks_ok, claude_ok, results_ok, skill_ok]
passed = sum(tests)
total = len(tests)
print(f'  Results: {passed}/{total} tests passed', flush=True)
if passed == total:
    print('  ALL TESTS PASSED!', flush=True)
else:
    print(f'  {total - passed} test(s) failed', flush=True)
print('='*60, flush=True)

c.close()
print('\nPhase 6 complete!', flush=True)
