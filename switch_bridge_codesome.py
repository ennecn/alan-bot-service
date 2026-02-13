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

# Kill existing bridge
print("=== Kill existing bridge ===")
run("pkill -f 'node.*cc-bridge' 2>/dev/null")
time.sleep(2)

# Start bridge with Codesome env
print("=== Start bridge with Codesome ===")
start_cmd = (
    "cd /Users/fangjin/cc-bridge && "
    "ANTHROPIC_API_KEY=sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8 "
    "ANTHROPIC_BASE_URL=https://v3.codesome.cn "
    "nohup /opt/homebrew/bin/node cc-bridge.js > /Users/fangjin/cc-bridge/bridge.log 2>&1 &"
)
run(start_cmd)
time.sleep(3)

# Verify
out, _ = run("curl -s http://localhost:9090/health --max-time 5")
print(f"Health: {out}")

out, _ = run("tail -3 /Users/fangjin/cc-bridge/bridge.log")
print(f"Log: {out}")

# Update .env for reference
run("cat > /Users/fangjin/cc-bridge/.env << 'EOF'\nANTHROPIC_API_KEY=sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8\nANTHROPIC_BASE_URL=https://v3.codesome.cn\nEOF")

mac.close()
print("\n[DONE] Bridge switched to Codesome. Quota resets in ~30 min.")
