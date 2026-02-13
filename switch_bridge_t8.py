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

# Step 1: Check current bridge status
print("=== Step 1: Check cc-bridge status ===")
out, err = run("ps aux | grep cc-bridge | grep -v grep")
print(f"Process: {out or 'NOT RUNNING'}")

out, err = run("curl -s http://localhost:9090/health --max-time 5")
print(f"Health: {out or 'NO RESPONSE'}")

# Step 2: Check current env vars
print("\n=== Step 2: Current ANTHROPIC env ===")
out, err = run("cat /Users/fangjin/cc-bridge/.env 2>/dev/null || echo 'No .env file'")
print(f".env: {out}")

# Step 3: Kill existing bridge
print("\n=== Step 3: Kill existing bridge ===")
out, err = run("pkill -f 'node.*cc-bridge' 2>/dev/null; sleep 1; ps aux | grep cc-bridge | grep -v grep")
print(f"After kill: {out or 'Process killed successfully'}")

# Step 4: Create .env file with T8 config
print("\n=== Step 4: Write T8 config ===")
env_content = """ANTHROPIC_API_KEY=sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW
ANTHROPIC_BASE_URL=https://ai.t8star.cn
"""
run(f"cat > /Users/fangjin/cc-bridge/.env << 'ENVEOF'\n{env_content}ENVEOF")
out, err = run("cat /Users/fangjin/cc-bridge/.env")
print(f"New .env:\n{out}")

# Step 5: Start bridge with T8 env vars
print("\n=== Step 5: Start cc-bridge with T8 ===")
start_cmd = (
    "cd /Users/fangjin/cc-bridge && "
    "export ANTHROPIC_API_KEY=sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW && "
    "export ANTHROPIC_BASE_URL=https://ai.t8star.cn && "
    "nohup node cc-bridge.js > /Users/fangjin/cc-bridge/bridge.log 2>&1 &"
)
run(start_cmd)
time.sleep(3)

# Step 6: Verify bridge is running
print("\n=== Step 6: Verify bridge ===")
out, err = run("ps aux | grep cc-bridge | grep -v grep | head -2")
print(f"Process: {out or 'NOT RUNNING!'}")

out, err = run("curl -s http://localhost:9090/health --max-time 5")
print(f"Health: {out or 'NO RESPONSE!'}")

# Check the last few lines of log
out, err = run("tail -5 /Users/fangjin/cc-bridge/bridge.log")
print(f"\nBridge log:\n{out}")

mac.close()
print("\n[DONE]")
