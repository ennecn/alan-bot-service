import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Find node path
print("=== Finding node ===")
out, _ = run("which node")
print(f"node: {out}")
out2, _ = run("/opt/homebrew/bin/node --version")
print(f"node version: {out2}")

# Start bridge with full path
print("\n=== Starting bridge with full node path ===")
start_cmd = (
    "cd /Users/fangjin/cc-bridge && "
    "ANTHROPIC_API_KEY=sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW "
    "ANTHROPIC_BASE_URL=https://ai.t8star.cn "
    "nohup /opt/homebrew/bin/node cc-bridge.js > /Users/fangjin/cc-bridge/bridge.log 2>&1 &"
)
run(start_cmd)
time.sleep(3)

# Verify
print("=== Verify ===")
out, _ = run("ps aux | grep cc-bridge | grep -v grep | head -2")
print(f"Process: {out or 'NOT RUNNING!'}")

out, _ = run("curl -s http://localhost:9090/health --max-time 5")
print(f"Health: {out}")

out, _ = run("tail -5 /Users/fangjin/cc-bridge/bridge.log")
print(f"\nLog:\n{out}")

# Verify T8 env is being used
print("\n=== Check env in process ===")
out, _ = run("ps aux | grep cc-bridge | grep -v grep")
print(out)

mac.close()
print("\n[DONE]")
