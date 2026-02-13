#!/usr/bin/env python3
import paramiko
import json
import time

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
            if not chunk:
                break
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
    # Strip ANSI escape codes
    import re
    text = re.sub(r'\x1b\[[^m]*m|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', text)
    return text.strip(), code

# Step 0: Clean up previous results
print("=" * 60)
print("[STEP 0] Cleaning up previous results...")
run("rm -f /Users/fangjin/claude-code-results/latest.json /tmp/openclaw-notify.lock")
run("rm -f /Users/fangjin/claude-workspace/alin/task-output.txt /Users/fangjin/claude-workspace/alin/task-meta.json")
print("[OK] Cleaned up")

# Step 1: Run dispatch script
print("\n" + "=" * 60)
print("[STEP 1] Running dispatch script...")
out, code = run('/Users/fangjin/claude-code-dispatch.sh -p "Create a file called test-hook.txt with the content: Hook test successful at $(date). Reply with just the file path you created." -n "hook-test" -t 5', timeout=15)
print(f"[EXIT] {code}")
print(f"[OUTPUT]\n{out}")

try:
    dispatch_info = json.loads(out.split('\n')[-1] if '\n' in out else out)
    if dispatch_info.get('status') == 'dispatched':
        print(f"\n[OK] Task dispatched! PID: {dispatch_info.get('pid')}")
    else:
        print(f"\n[WARN] Unexpected dispatch response")
except:
    # Try to find JSON in output
    for line in out.split('\n'):
        line = line.strip()
        if line.startswith('{'):
            try:
                dispatch_info = json.loads(line)
                print(f"\n[OK] Task dispatched! PID: {dispatch_info.get('pid')}")
                break
            except:
                pass
    else:
        print(f"\n[WARN] Could not parse dispatch output")

# Step 2: Wait for Claude Code to finish (poll for latest.json)
print("\n" + "=" * 60)
print("[STEP 2] Waiting for Claude Code to complete (polling latest.json)...")
max_wait = 120
start = time.time()
found = False

while time.time() - start < max_wait:
    out, code = run("cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null", timeout=5)
    if code == 0 and out and '"status"' in out:
        found = True
        elapsed = int(time.time() - start)
        print(f"[OK] latest.json found after {elapsed}s!")
        break
    elapsed = int(time.time() - start)
    print(f"  ... waiting ({elapsed}s)", flush=True)
    time.sleep(5)

if not found:
    print(f"[TIMEOUT] latest.json not found after {max_wait}s")
    # Check if Claude Code is still running
    out, _ = run("pgrep -f 'claude.*hook-test' || echo 'not running'", timeout=5)
    print(f"[DEBUG] Claude process: {out}")
    out, _ = run("cat /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null | tail -20", timeout=5)
    print(f"[DEBUG] task-output.txt tail:\n{out}")
    client.close()
    exit(1)

# Step 3: Read and display latest.json
print("\n" + "=" * 60)
print("[STEP 3] Reading latest.json...")
out, _ = run("cat /Users/fangjin/claude-code-results/latest.json", timeout=5)
print(out)

try:
    result = json.loads(out)
    print(f"\n[RESULT SUMMARY]")
    print(f"  Event: {result.get('event')}")
    print(f"  Task: {result.get('task_name')}")
    print(f"  Status: {result.get('status')}")
    print(f"  Timestamp: {result.get('timestamp')}")
    has_output = bool(result.get('output', '').strip())
    print(f"  Has output: {has_output}")
except:
    print("[WARN] Could not parse latest.json")

# Step 4: Check if the test file was created
print("\n" + "=" * 60)
print("[STEP 4] Checking if Claude Code created test-hook.txt...")
out, code = run("cat /Users/fangjin/claude-workspace/alin/test-hook.txt 2>/dev/null", timeout=5)
if code == 0 and out:
    print(f"[OK] test-hook.txt content: {out}")
else:
    print("[INFO] test-hook.txt not found (Claude may have created it elsewhere)")

print("\n" + "=" * 60)
print("[DONE] End-to-end hook test complete!")

client.close()
