#!/usr/bin/env python3
"""Fix node pairing: separate state dirs for each node instance.
Problem: all 4 node instances share ~/.openclaw/ and overwrite each other's tokens.
Solution: OPENCLAW_STATE_DIR gives each instance its own state directory."""
import paramiko, json, time

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

NODES = {
    "alin":  {"port": 18789, "label": "ai.openclaw.node",       "plist": "ai.openclaw.node.plist"},
    "lain":  {"port": 18790, "label": "ai.openclaw.node.lain",  "plist": "ai.openclaw.node.lain.plist"},
    "aling": {"port": 18791, "label": "ai.openclaw.node.aling", "plist": "ai.openclaw.node.aling.plist"},
    "lumi":  {"port": 18792, "label": "ai.openclaw.node.lumi",  "plist": "ai.openclaw.node.lumi.plist"},
}

PLIST_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>{label}</string>
    <key>Comment</key>
    <string>OpenClaw Node Host ({name})</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>/opt/homebrew/lib/node_modules/openclaw/dist/index.js</string>
      <string>node</string>
      <string>run</string>
      <string>--host</string>
      <string>127.0.0.1</string>
      <string>--port</string>
      <string>{port}</string>
      <string>--display-name</string>
      <string>MacMini</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>OPENCLAW_GATEWAY_PASSWORD</key>
      <string>openclaw123</string>
      <key>OPENCLAW_STATE_DIR</key>
      <string>{state_dir}</string>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>HOME</key>
      <string>/Users/fangjin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/fangjin/.openclaw/logs/node-{name}.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/fangjin/.openclaw/logs/node-{name}.err.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
  </dict>
</plist>
"""

# Step 1: Unload all existing node services
print("Step 1: Unloading existing node services...")
for name, info in NODES.items():
    cmd = f"launchctl unload ~/Library/LaunchAgents/{info['plist']} 2>/dev/null; echo done"
    c.exec_command(cmd)[1].read()
    print(f"  Unloaded {info['label']}")

time.sleep(2)

# Step 2: Create separate state directories with identity copies
print("\nStep 2: Creating separate state directories...")
sftp = c.open_sftp()
for name, info in NODES.items():
    state_dir = f"/Users/fangjin/.openclaw-node-{name}"
    cmd = f"mkdir -p {state_dir}/identity {state_dir}/logs"
    c.exec_command(cmd)[1].read()

    # Copy identity files (same key pair for all - same node identity)
    cmd = f"cp /Users/fangjin/.openclaw/identity/device.json {state_dir}/identity/"
    c.exec_command(cmd)[1].read()
    # Each gets its own device-auth.json (will be populated on first connect)
    cmd = f'test -f {state_dir}/identity/device-auth.json || echo \'{{"version":1}}\' > {state_dir}/identity/device-auth.json'
    c.exec_command(cmd)[1].read()

    # Copy openclaw.json and exec-approvals.json
    cmd = f"cp /Users/fangjin/.openclaw/openclaw.json {state_dir}/ 2>/dev/null; cp /Users/fangjin/.openclaw/exec-approvals.json {state_dir}/ 2>/dev/null"
    c.exec_command(cmd)[1].read()

    # Write node.json pointing to this bot's port
    node_json = json.dumps({
        "version": 1,
        "nodeId": "1cac1d8c-cafc-4848-889e-667e06a2b925",
        "displayName": "MacMini",
        "gateway": {"host": "127.0.0.1", "port": info["port"], "tls": False}
    }, indent=2)
    with sftp.open(f"{state_dir}/node.json", "wb") as f:
        f.write(node_json.encode())

    print(f"  {name}: {state_dir} (port={info['port']})")

# Step 3: Write updated plists with OPENCLAW_STATE_DIR
print("\nStep 3: Writing updated launchd plists...")
for name, info in NODES.items():
    state_dir = f"/Users/fangjin/.openclaw-node-{name}"
    plist_path = f"/Users/fangjin/Library/LaunchAgents/{info['plist']}"
    content = PLIST_TEMPLATE.format(
        label=info["label"], name=name, port=info["port"], state_dir=state_dir
    )
    with sftp.open(plist_path, "wb") as f:
        f.write(content.encode())
    print(f"  Written {info['plist']}")

sftp.close()

# Step 4: Load all services
print("\nStep 4: Loading node services...")
for name, info in NODES.items():
    cmd = f"launchctl load ~/Library/LaunchAgents/{info['plist']}"
    si, so, se = c.exec_command(cmd)
    so.read()
    err = se.read().decode().strip()
    if err:
        print(f"  {name}: {err}")
    else:
        print(f"  {name}: loaded")

print("\nWaiting 10s for nodes to connect and pair...")
time.sleep(10)

# Step 5: Verify
print("\n=== Verification ===")
si, so, se = c.exec_command("launchctl list | grep openclaw.node")
print("Launchd services:")
print(so.read().decode().strip())

# Check error logs
print("\nNode error logs:")
for name in NODES:
    cmd = f"tail -3 /Users/fangjin/.openclaw/logs/node-{name}.err.log 2>/dev/null"
    si, so, se = c.exec_command(cmd)
    out = so.read().decode("utf-8", errors="replace").strip()
    print(f"  {name}: {out}" if out else f"  {name}: (clean)")

# Check state dirs for device-auth.json updates
print("\nDevice auth tokens:")
for name in NODES:
    state_dir = f"/Users/fangjin/.openclaw-node-{name}"
    cmd = f"cat {state_dir}/identity/device-auth.json 2>/dev/null"
    si, so, se = c.exec_command(cmd)
    out = so.read().decode("utf-8", errors="replace").strip()
    has_token = '"token"' in out
    print(f"  {name}: {'has token' if has_token else 'no token yet'}")

c.close()
print("\nDone!")
