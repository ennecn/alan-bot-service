#!/usr/bin/env python3
"""Install dev-browser on Mac Mini - debug version with better timing."""
import paramiko
import time
import sys
import json

# Fix Windows encoding
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

TMUX = "/opt/homebrew/bin/tmux"
SESSION = "pi"

def run(cmd, timeout=30):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode().strip(), se.read().decode().strip()

def capture(lines=80):
    out, _ = run(f"{TMUX} capture-pane -t {SESSION} -p -S -{lines}")
    return out

def send(text):
    # Use tmux send-keys with literal flag to avoid interpretation
    run(f"""{TMUX} send-keys -t {SESSION} -l '{text}'""")
    time.sleep(0.3)
    run(f"{TMUX} send-keys -t {SESSION} Enter")

def wait_for(pattern, timeout=60, interval=3):
    """Wait until pattern appears in tmux pane."""
    start = time.time()
    while time.time() - start < timeout:
        pane = capture()
        if pattern in pane:
            return True, pane
        time.sleep(interval)
    return False, capture()

# Cleanup
print("1. Cleanup...")
run(f"{TMUX} kill-session -t {SESSION} 2>/dev/null")
time.sleep(1)

# Start tmux with a shell first
print("2. Starting tmux session...")
run(f"{TMUX} new-session -d -s {SESSION} -x 200 -y 50")
time.sleep(2)

# Check tmux is running
out, _ = run(f"{TMUX} list-sessions")
print(f"   Sessions: {out}")

# Start claude in the tmux session
print("3. Starting Claude Code...")
send("/opt/homebrew/bin/claude --dangerously-skip-permissions")
time.sleep(5)

pane = capture(30)
print("   Initial pane (last 10 lines):")
for line in pane.split("\n")[-10:]:
    stripped = line.strip()
    if stripped:
        print(f"   | {stripped}")

# Handle API key prompt if present
if "Do you want to use this API key" in pane:
    print("\n   Detected API key prompt, selecting Yes...")
    # It's a selection UI - press Up arrow to move to "Yes", then Enter
    run(f"{TMUX} send-keys -t {SESSION} Up")
    time.sleep(0.5)
    run(f"{TMUX} send-keys -t {SESSION} Enter")
    time.sleep(8)  # Wait for Claude Code to fully load
    pane = capture(30)
    print("   After API key selection:")
    for line in pane.split("\n")[-8:]:
        stripped = line.strip()
        if stripped:
            print(f"   | {stripped}")

# Wait for Claude Code to be ready (look for prompt indicator)
print("\n4. Waiting for Claude Code to be ready...")
found, pane = wait_for("$", timeout=20, interval=2)
if not found:
    # Try looking for other indicators
    found, pane = wait_for(">", timeout=10, interval=2)

print("   Current pane:")
for line in pane.split("\n")[-15:]:
    stripped = line.strip()
    if stripped:
        print(f"   | {stripped}")

# Send marketplace add command
print("\n5. Adding marketplace...")
send("/plugin marketplace add sawyerhood/dev-browser")

# Wait for completion (look for success message or prompt return)
print("   Waiting for marketplace add...")
time.sleep(30)  # Git clone can be slow from China

pane = capture(40)
print("   After marketplace add:")
for line in pane.split("\n")[-15:]:
    stripped = line.strip()
    if stripped:
        print(f"   | {stripped}")

# Check if marketplace was added
out, _ = run("cat /Users/fangjin/.claude/plugins/known_marketplaces.json")
if "sawyerhood" in out:
    print("   Marketplace added successfully!")
else:
    print("   WARNING: marketplace may not have been added yet, waiting more...")
    time.sleep(20)
    pane = capture(40)
    for line in pane.split("\n")[-10:]:
        stripped = line.strip()
        if stripped:
            print(f"   | {stripped}")

# Send plugin install command
print("\n6. Installing plugin...")
send("/plugin install dev-browser@sawyerhood/dev-browser")

# Wait longer for npm install
print("   Waiting for plugin install (may take a while)...")
time.sleep(15)

# Check if scope selection prompt appeared
pane = capture(40)
if "Install for you" in pane or "user scope" in pane:
    print("   Scope selection prompt detected, pressing Enter for user scope...")
    run(f"{TMUX} send-keys -t {SESSION} Enter")
    time.sleep(60)  # Wait for actual installation (npm install etc.)

pane = capture(60)
print("   After plugin install:")
for line in pane.split("\n")[-20:]:
    stripped = line.strip()
    if stripped:
        print(f"   | {stripped}")

# Exit claude
print("\n7. Exiting...")
send("/exit")
time.sleep(3)

# Kill session
run(f"{TMUX} kill-session -t {SESSION} 2>/dev/null")

# Verify
print("\n8. Verification...")
out, _ = run("cat /Users/fangjin/.claude/plugins/installed_plugins.json")
import json
try:
    plugins = json.loads(out)
    plugin_names = list(plugins.get("plugins", {}).keys())
    print(f"   Installed plugins: {plugin_names}")
    if any("dev-browser" in k for k in plugin_names):
        print("   dev-browser: INSTALLED!")
    else:
        print("   dev-browser: NOT FOUND")
except:
    print(f"   Raw: {out[:300]}")

out, _ = run("cat /Users/fangjin/.claude/plugins/known_marketplaces.json")
try:
    km = json.loads(out)
    print(f"   Marketplaces: {list(km.keys())}")
except:
    print(f"   Raw: {out[:300]}")

c.close()
print("\nDone!")
