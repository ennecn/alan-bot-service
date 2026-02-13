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

# Write a separate patch script to Mac Mini
patch_js = """
const fs = require('fs');
const file = '/Users/fangjin/cc-bridge/cc-bridge.js';
let code = fs.readFileSync(file, 'utf8');

// Find and replace the env block to add PATH
const oldLine = "      HOME: '/Users/fangjin',";
const newLine = "      HOME: '/Users/fangjin',\\n      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:' + (process.env.PATH || ''),";

if (code.includes("PATH: '/opt/homebrew/bin")) {
  console.log('Already patched');
} else if (code.includes(oldLine)) {
  code = code.replace(oldLine, newLine);
  fs.writeFileSync(file, code);
  console.log('PATCHED OK');
} else {
  console.log('Pattern not found');
}
"""

# Write patch script via SFTP
sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/cc-bridge/patch-path.js', 'w') as f:
    f.write(patch_js)
sftp.close()

print("=== Running patch script ===")
out, err = run("/opt/homebrew/bin/node /Users/fangjin/cc-bridge/patch-path.js")
print(f"Result: {out}")
if err: print(f"Err: {err}")

# Verify
print("\n=== Verify env block ===")
out, _ = run("grep -A 8 'env: {' /Users/fangjin/cc-bridge/cc-bridge.js | head -10")
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

# Now do the actual E2E test
print("\n=== E2E Test: Call bridge ===")
body = json.dumps({
    "session_id": "t8-test-2",
    "message": "Say exactly: T8 bridge test successful. Nothing else.",
    "model": "claude-opus-4-6-thinking"
})

out, err = run(
    f"curl -sN http://localhost:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 90",
    timeout=100
)
print(f"Response ({len(out)} chars):")

# Parse SSE
for line in out.split('\n'):
    line = line.strip()
    if line.startswith('data: '):
        try:
            data = json.loads(line[6:])
            dtype = data.get('type', '')
            if dtype == 'result':
                print(f"  [RESULT] {json.dumps(data.get('result', ''), ensure_ascii=False)[:500]}")
            elif dtype == 'assistant':
                msg = data.get('message', {})
                for block in msg.get('content', []):
                    if block.get('type') == 'text':
                        print(f"  [TEXT] {block['text'][:300]}")
                    elif block.get('type') == 'thinking':
                        think = block.get('thinking', '')
                        print(f"  [THINKING] {think[:200]}")
            elif 'exit_code' in data:
                print(f"  [DONE] exit_code={data['exit_code']}")
            elif 'session_id' in data and 'uuid' in data:
                print(f"  [SESSION] {data['session_id']}")
            elif 'text' in data:
                print(f"  [LOG] {data['text'][:300]}")
        except:
            print(f"  [RAW] {line[:200]}")

if err:
    print(f"\nSTDERR: {err[:500]}")

# Check bridge log
print("\n=== Bridge log tail ===")
out, _ = run("tail -10 /Users/fangjin/cc-bridge/bridge.log")
print(out)

mac.close()
print("\n[DONE]")
