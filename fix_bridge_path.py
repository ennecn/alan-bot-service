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

# Check current PATH in the bridge's env
print("=== Current bridge cc-bridge.js spawn env ===")
out, _ = run("grep -n 'env:' /Users/fangjin/cc-bridge/cc-bridge.js | head -5")
print(out)

# Fix: Add PATH to the spawn env in cc-bridge.js
# Replace the env block in runClaudeCode to include PATH with /opt/homebrew/bin
print("\n=== Patching cc-bridge.js ===")

patch_script = r"""
cd /Users/fangjin/cc-bridge

# Backup
cp cc-bridge.js cc-bridge.js.bak

# Use node to patch the file precisely
/opt/homebrew/bin/node -e "
const fs = require('fs');
let code = fs.readFileSync('cc-bridge.js', 'utf8');

// Replace the env block in spawn to include PATH
const oldEnv = `env: {
      ...process.env,
      HOME: '/Users/fangjin',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
    },`;

const newEnv = `env: {
      ...process.env,
      HOME: '/Users/fangjin',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:' + (process.env.PATH || ''),
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
    },`;

if (code.includes(oldEnv)) {
  code = code.replace(oldEnv, newEnv);
  fs.writeFileSync('cc-bridge.js', code);
  console.log('PATCHED successfully');
} else {
  console.log('Pattern not found - checking current env block...');
  const match = code.match(/env: \{[^}]+\}/s);
  if (match) console.log('Current env block:', match[0]);
  else console.log('No env block found');
}
"
"""
out, err = run(patch_script)
print(f"Patch result: {out}")
if err: print(f"Err: {err}")

# Verify patch
print("\n=== Verify patched env block ===")
out, _ = run("grep -A 7 'env: {' /Users/fangjin/cc-bridge/cc-bridge.js")
print(out)

# Restart bridge
print("\n=== Restart bridge ===")
run("pkill -f 'node.*cc-bridge' 2>/dev/null")
time.sleep(2)

start_cmd = (
    "cd /Users/fangjin/cc-bridge && "
    "ANTHROPIC_API_KEY=sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW "
    "ANTHROPIC_BASE_URL=https://ai.t8star.cn "
    "nohup /opt/homebrew/bin/node cc-bridge.js > /Users/fangjin/cc-bridge/bridge.log 2>&1 &"
)
run(start_cmd)
time.sleep(3)

out, _ = run("curl -s http://localhost:9090/health --max-time 5")
print(f"Health: {out}")

out, _ = run("tail -3 /Users/fangjin/cc-bridge/bridge.log")
print(f"Log: {out}")

mac.close()
print("\n[DONE]")
