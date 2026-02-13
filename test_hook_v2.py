#!/usr/bin/env python3
"""Test updated hook with wake event and telegram message"""
import paramiko, time, json, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    channel = client.get_transport().open_session()
    channel.get_pty()
    channel.settimeout(timeout)
    channel.exec_command(cmd)
    out = b""
    start = time.time()
    while time.time() - start < timeout:
        if channel.recv_ready():
            chunk = channel.recv(4096)
            if not chunk: break
            out += chunk
        elif channel.exit_status_ready():
            while channel.recv_ready():
                out += channel.recv(4096)
            break
        else:
            time.sleep(0.3)
    code = channel.recv_exit_status()
    channel.close()
    text = out.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[^m]*m|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', text)
    return text.strip(), code

# Clean up
print("=" * 60)
print("[STEP 0] Cleanup")
run("rm -f /Users/fangjin/claude-code-results/latest.json /Users/fangjin/claude-code-results/pending-wake.json /Users/fangjin/claude-code-results/.hook-lock /Users/fangjin/claude-code-results/hook.log")
run("rm -f /Users/fangjin/claude-workspace/alin/task-output.txt")
run("/opt/homebrew/bin/tmux kill-server 2>/dev/null", timeout=5)
print("[OK]")

# Step 1: Dispatch with telegram group (use the known chat ID)
print("\n" + "=" * 60)
print("[STEP 1] Dispatch with -g telegram group")
# Using the known Telegram alert chat ID from memory
out, code = run('/Users/fangjin/claude-code-dispatch.sh -p "Create a file called hook-v2-test.txt with content: Hook v2 test passed. Reply with the file path." -n "hook-v2" -t 5 -g "6564284621"', timeout=15)
print(f"[EXIT] {code}")
print(f"[OUTPUT]\n{out}")

# Step 2: Wait for completion
print("\n" + "=" * 60)
print("[STEP 2] Wait for task completion")
max_wait = 90
start = time.time()
completed = False

while time.time() - start < max_wait:
    out, _ = run("/Users/fangjin/claude-code-status.sh -n hook-v2", timeout=10)
    if '"status": "completed"' in out or '"status":"completed"' in out:
        print(f"\n[COMPLETED] after {int(time.time()-start)}s")
        completed = True
        break
    if '"status":"no_active_task"' in out or '"status": "no_active_task"' in out:
        # Session ended, check results
        res, _ = run("cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null", timeout=5)
        if res and '"done"' in res:
            print(f"\n[COMPLETED via results] after {int(time.time()-start)}s")
            completed = True
            break
    print(f"  [{int(time.time()-start)}s] waiting...", flush=True)
    time.sleep(5)

if not completed:
    print(f"[TIMEOUT] after {max_wait}s")

# Step 3: Check all outputs
print("\n" + "=" * 60)
print("[STEP 3] Check results")

print("\n--- latest.json ---")
out, _ = run("cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null", timeout=5)
print(out[:500] if out else "(empty)")

print("\n--- pending-wake.json ---")
out, _ = run("cat /Users/fangjin/claude-code-results/pending-wake.json 2>/dev/null", timeout=5)
print(out[:300] if out else "(empty)")

print("\n--- hook.log ---")
out, _ = run("cat /Users/fangjin/claude-code-results/hook.log 2>/dev/null", timeout=5)
print(out if out else "(empty)")

print("\n--- test file ---")
out, _ = run("cat /Users/fangjin/claude-workspace/alin/hook-v2-test.txt 2>/dev/null", timeout=5)
print(out if out else "(not created)")

print("\n--- task-meta.json ---")
out, _ = run("cat /Users/fangjin/claude-workspace/alin/task-meta.json 2>/dev/null", timeout=5)
print(out[:300] if out else "(empty)")

print("\n" + "=" * 60)
print("[DONE]")
client.close()
