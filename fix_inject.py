#!/usr/bin/env python3
"""Fix inject script to use Node.js built-in WebSocket"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# Node.js 22+ has built-in WebSocket (global, no require needed)
inject_js = r'''#!/usr/bin/env node
// claude-code-inject.js - Inject message into OpenClaw gateway via built-in WebSocket
// Usage: node claude-code-inject.js "message text" [sessionKey]

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

const timer = setTimeout(() => {
  if (!done) {
    console.error("Timeout");
    process.exit(1);
  }
}, 8000);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    id: "auth-1",
    method: "auth",
    params: { token: GATEWAY_TOKEN }
  }));
});

ws.addEventListener("message", (event) => {
  try {
    const msg = JSON.parse(event.data);

    if (msg.id === "auth-1") {
      if (msg.error) {
        console.error("Auth failed:", JSON.stringify(msg.error));
        ws.close();
        process.exit(1);
      }
      const params = { message };
      if (sessionKey) params.sessionKey = sessionKey;
      ws.send(JSON.stringify({
        id: "inject-1",
        method: "chat.inject",
        params
      }));
    }

    if (msg.id === "inject-1") {
      done = true;
      clearTimeout(timer);
      if (msg.error) {
        console.error("Inject failed:", JSON.stringify(msg.error));
        ws.close();
        process.exit(1);
      }
      console.log("OK");
      ws.close();
      process.exit(0);
    }
  } catch (e) {}
});

ws.addEventListener("error", (e) => {
  console.error("WS error:", e.message || e);
  process.exit(1);
});
'''

with sftp.file('/Users/fangjin/claude-code-inject.js', 'w') as f:
    f.write(inject_js)
print("[1/2] inject.js updated (built-in WebSocket)")

# Test
stdin, stdout, stderr = client.exec_command(
    '/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "test inject" 2>&1'
)
result = stdout.read().decode().strip()
print(f"[2/2] Test: {result}")

sftp.close()
client.close()
