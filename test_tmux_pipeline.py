#!/usr/bin/env python3
"""End-to-end test of tmux-based Claude Code dispatch"""
import paramiko
import time
import json
import sys
import io
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
    import re
    text = out.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[^m]*m|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', text)
    return text.strip(), code

# Clean up
print("=" * 60)
print("[STEP 0] Cleanup")
run("rm -f /Users/fangjin/claude-code-results/latest.json /Users/fangjin/claude-workspace/alin/task-output.txt /tmp/openclaw-notify.lock")
run("/opt/homebrew/bin/tmux kill-server 2>/dev/null", timeout=5)
print("[OK]")

# Step 1: Dispatch
print("\n" + "=" * 60)
print("[STEP 1] Dispatch task via tmux")
out, code = run('/Users/fangjin/claude-code-dispatch.sh -p "Create a file called tmux-test.txt containing the text: tmux dispatch test successful. Then reply with the absolute path of the file you created." -n "tmux-test" -t 5', timeout=15)
print(f"[EXIT] {code}")
print(f"[OUTPUT]\n{out}")

# Step 2: Check session is running
print("\n" + "=" * 60)
print("[STEP 2] Verify tmux session exists")
time.sleep(2)
out, _ = run("/opt/homebrew/bin/tmux list-sessions 2>/dev/null", timeout=5)
print(f"[SESSIONS] {out}")

# Step 3: Poll status while running
print("\n" + "=" * 60)
print("[STEP 3] Poll progress via status script")
max_wait = 120
start = time.time()
completed = False

while time.time() - start < max_wait:
    out, _ = run("/Users/fangjin/claude-code-status.sh -n tmux-test -l 10", timeout=10)

    # Check if completed
    if '"status": "completed"' in out or '"status":"completed"' in out:
        print(f"\n[COMPLETED] after {int(time.time()-start)}s")
        completed = True
        break

    if '"status": "no_active_task"' in out or '"status":"not_found"' in out:
        # Session ended, check results
        res_out, _ = run("cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null", timeout=5)
        if res_out and "completed" in res_out:
            print(f"\n[COMPLETED via results] after {int(time.time()-start)}s")
            completed = True
            break

    elapsed = int(time.time() - start)
    # Extract a short status hint
    if '"status": "running"' in out or '"status":"running"' in out:
        print(f"  [{elapsed}s] running...", flush=True)
    else:
        print(f"  [{elapsed}s] waiting...", flush=True)

    time.sleep(5)

if not completed:
    print(f"[TIMEOUT] after {max_wait}s")
    out, _ = run("/Users/fangjin/claude-code-status.sh -n tmux-test -l 30", timeout=10)
    print(f"[FINAL STATUS]\n{out}")

# Step 4: Check results
print("\n" + "=" * 60)
print("[STEP 4] Check results")
out, _ = run("cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null", timeout=5)
print(f"[latest.json] {out}")

out, _ = run("cat /Users/fangjin/claude-workspace/alin/tmux-test.txt 2>/dev/null", timeout=5)
print(f"[tmux-test.txt] {out}")

out, _ = run("cat /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null | tail -3", timeout=5)
print(f"[task-output.txt tail] {out}")

# Step 5: List sessions
print("\n" + "=" * 60)
print("[STEP 5] List sessions")
out, _ = run("/Users/fangjin/claude-code-list.sh", timeout=5)
print(f"[LIST] {out}")

print("\n" + "=" * 60)
print("[DONE]")
client.close()
