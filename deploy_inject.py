#!/usr/bin/env python3
"""Deploy WebSocket inject script + update hook to use it"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# ============================================================
# 1. WebSocket inject script (Node.js)
# ============================================================
inject_js = r'''#!/usr/bin/env node
// claude-code-inject.js - Inject a message into OpenClaw gateway via WebSocket
// Usage: node claude-code-inject.js "message text" [sessionKey]
const WebSocket = require("ws");

const GATEWAY_URL = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "mysecrettoken123";
const message = process.argv[2];
const sessionKey = process.argv[3] || "";

if (!message) {
  console.error("Usage: node claude-code-inject.js <message> [sessionKey]");
  process.exit(1);
}

const ws = new WebSocket(GATEWAY_URL);
let done = false;

const timeout = setTimeout(() => {
  if (!done) {
    console.error("Timeout connecting to gateway");
    ws.close();
    process.exit(1);
  }
}, 8000);

ws.on("open", () => {
  // Authenticate
  ws.send(JSON.stringify({
    id: "auth-1",
    method: "auth",
    params: { token: GATEWAY_TOKEN }
  }));
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.id === "auth-1") {
      if (msg.error) {
        console.error("Auth failed:", msg.error);
        ws.close();
        process.exit(1);
      }
      // Auth OK, send inject
      const injectParams = {
        message: message,
        role: "system"
      };
      if (sessionKey) {
        injectParams.sessionKey = sessionKey;
      }
      ws.send(JSON.stringify({
        id: "inject-1",
        method: "chat.inject",
        params: injectParams
      }));
    }

    if (msg.id === "inject-1") {
      done = true;
      clearTimeout(timeout);
      if (msg.error) {
        console.error("Inject failed:", JSON.stringify(msg.error));
        ws.close();
        process.exit(1);
      }
      console.log("OK: message injected");
      ws.close();
      process.exit(0);
    }
  } catch (e) {
    // ignore parse errors
  }
});

ws.on("error", (err) => {
  console.error("WS error:", err.message);
  process.exit(1);
});

ws.on("close", () => {
  if (!done) process.exit(1);
});
'''

with sftp.file('/Users/fangjin/claude-code-inject.js', 'w') as f:
    f.write(inject_js)
stdin, stdout, stderr = client.exec_command('chmod +x /Users/fangjin/claude-code-inject.js')
stdout.read()
print("[1/3] claude-code-inject.js deployed")

# ============================================================
# 2. Check if ws module is available
# ============================================================
stdin, stdout, stderr = client.exec_command('node -e "require(\'ws\')" 2>&1')
ws_check = stdout.read().decode().strip()
if 'Cannot find' in ws_check or 'Error' in ws_check:
    print("[!] ws module not found, installing...")
    stdin, stdout, stderr = client.exec_command('npm install -g ws 2>&1')
    print(stdout.read().decode().strip()[-200:])
else:
    print("[2/3] ws module available")

# ============================================================
# 3. Update hook to use inject script instead of curl
# ============================================================
with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'r') as f:
    hook = f.read().decode()

# Replace the wake event section
old_wake = '''# ---- Wake AGI via Gateway API ----
WAKE_TEXT="Claude Code task '${TASK_NAME}' completed. Read /Users/fangjin/claude-code-results/latest.json"
curl -s -X POST "${GATEWAY_URL}/api/cron/wake" \\
    -H "Authorization: Bearer $GATEWAY_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "{\\"text\\": $(echo "$WAKE_TEXT" | $JQ -Rs .), \\"mode\\": \\"now\\"}" \\
    --max-time 5 \\
    > /dev/null 2>&1 \\
    && log "Wake event sent" \\
    || log "Wake event failed (non-fatal)"'''

new_wake = '''# ---- Notify AGI via WebSocket inject ----
WAKE_TEXT="[Claude Code 任务完成] 任务 '${TASK_NAME}' 已完成。请读取 /Users/fangjin/claude-code-results/latest.json 获取结果，然后向用户汇报。"
/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$WAKE_TEXT" \
    > /dev/null 2>&1 \
    && log "WebSocket inject sent" \
    || log "WebSocket inject failed (non-fatal)"'''

if old_wake in hook:
    hook = hook.replace(old_wake, new_wake)
    with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'w') as f:
        f.write(hook)
    print("[3/3] Hook updated: curl -> WebSocket inject")
else:
    print("[3/3] WARNING: Could not find old wake section in hook")
    # Try to show what's there
    stdin, stdout, stderr = client.exec_command('grep -n "Wake\\|wake\\|curl.*cron" /Users/fangjin/.claude/hooks/notify-openclaw.sh')
    print(f"  Current wake lines: {stdout.read().decode().strip()}")

# ============================================================
# 4. Test inject
# ============================================================
print("\n--- Testing inject ---")
stdin, stdout, stderr = client.exec_command(
    '/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "test inject from deploy script" 2>&1'
)
result = stdout.read().decode().strip()
print(f"Inject test: {result}")

sftp.close()
client.close()
