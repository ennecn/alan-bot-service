#!/usr/bin/env python3
"""Fix: Create openclaw-node instances for all 4 bots.
Currently only alin (port 18789) has a node host. Need to add lain, aling, lumi."""
import paramiko, time

BOTS = {
    "lain":  {"port": 18790, "display": "MacMini-Lain"},
    "aling": {"port": 18791, "display": "MacMini-Aling"},
    "lumi":  {"port": 18792, "display": "MacMini-Lumi"},
}

PLIST_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.openclaw.node.{name}</string>
    <key>Comment</key>
    <string>OpenClaw Node Host ({display})</string>
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

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

# Ensure log dir exists
c.exec_command("mkdir -p /Users/fangjin/.openclaw/logs")[1].read()

# Kill stale cc-bridge.js
print("Killing stale cc-bridge.js...")
si, so, se = c.exec_command("pkill -f 'cc-bridge.js' 2>/dev/null; echo done")
so.read()

# Deploy plists for 3 bots
sftp = c.open_sftp()
for name, bot in BOTS.items():
    plist_path = f"/Users/fangjin/Library/LaunchAgents/ai.openclaw.node.{name}.plist"
    content = PLIST_TEMPLATE.format(name=name, port=bot["port"], display=bot["display"])

    # Unload if exists
    c.exec_command(f"launchctl unload {plist_path} 2>/dev/null")[1].read()

    # Write plist
    with sftp.open(plist_path, "wb") as f:
        f.write(content.encode("utf-8"))
    print(f"  Written {plist_path} (port={bot['port']})")

    # Load service
    si, so, se = c.exec_command(f"launchctl load {plist_path}")
    so.read()
    err = se.read().decode().strip()
    if err:
        print(f"  launchctl load warning: {err}")
    else:
        print(f"  Loaded ai.openclaw.node.{name}")

sftp.close()

# Wait for services to start
print("\nWaiting 5s for services to connect...")
time.sleep(5)

# Verify all node services
print("\nVerification:")
si, so, se = c.exec_command("launchctl list | grep openclaw.node")
out = so.read().decode().strip()
print(f"  Launchd services:\n{out}")

# Check processes
si, so, se = c.exec_command("ps aux | grep 'openclaw-node\\|openclaw.*node.*run' | grep -v grep")
out = so.read().decode().strip()
print(f"\n  Running processes:\n{out}")

# Test node connectivity from each bot container
print("\nTesting node connectivity from containers...")
containers = {
    "deploy-openclaw-gateway-1": "alin (18789)",
    "lain-gateway": "lain (18790)",
    "aling-gateway": "aling (18791)",
    "lumi-gateway": "lumi (18792)",
}
for container, label in containers.items():
    cmd = f'/usr/local/bin/docker logs --tail 5 {container} 2>&1 | grep -i "node"'
    si, so, se = c.exec_command(cmd)
    out = so.read().decode("utf-8", errors="replace").strip()
    print(f"  {label}: {out[-200:] if out else '(no node logs yet)'}")

c.close()
print("\nDone!")
