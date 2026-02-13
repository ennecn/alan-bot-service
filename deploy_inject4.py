#!/usr/bin/env python3
"""Fix: add type:'req' to all request frames"""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

inject_js = r'''#!/usr/bin/env node
// claude-code-inject.js v4 - Fixed: type:"req" in all request frames
const message = process.argv[2];
const method = process.argv[3] || "wake";
if (!message) { console.error("Usage: node inject.js <message> [wake|inject]"); process.exit(1); }

const GATEWAY_URL = "ws://127.0.0.1:18789";
const GATEWAY_PASSWORD = process.env.OPENCLAW_GATEWAY_PASSWORD || "openclaw123";

const ws = new WebSocket(GATEWAY_URL);
let step = "connecting";

const timer = setTimeout(() => { console.error("TIMEOUT at step:", step); process.exit(1); }, 10000);

ws.addEventListener("open", () => { step = "waiting-challenge"; });

ws.addEventListener("message", (event) => {
  try {
    const msg = JSON.parse(event.data);

    // Challenge -> send connect
    if (msg.type === "event" && msg.event === "connect.challenge") {
      step = "sending-connect";
      ws.send(JSON.stringify({
        type: "req",
        id: "c1",
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            version: "1.0.0",
            platform: "node",
            mode: "backend"
          },
          auth: { password: GATEWAY_PASSWORD }
        }
      }));
      return;
    }

    // Connect response
    if (msg.type === "res" && msg.id === "c1") {
      if (!msg.ok || msg.error) {
        console.error("Connect failed:", JSON.stringify(msg.error || msg));
        ws.close(); process.exit(1);
      }
      step = "sending-" + method;

      if (method === "wake") {
        ws.send(JSON.stringify({
          type: "req",
          id: "w1",
          method: "wake",
          params: { mode: "now", text: message }
        }));
      } else {
        ws.send(JSON.stringify({
          type: "req",
          id: "w1",
          method: "chat.inject",
          params: { message: message }
        }));
      }
      return;
    }

    // Wake/inject response
    if (msg.type === "res" && msg.id === "w1") {
      clearTimeout(timer);
      step = "done";
      if (!msg.ok || msg.error) {
        console.error("Failed:", JSON.stringify(msg.error || msg));
        ws.close(); process.exit(1);
      }
      console.log("OK");
      ws.close(); process.exit(0);
    }
  } catch(e) {}
});

ws.addEventListener("error", (e) => { console.error("WS error:", e.message || e.type); process.exit(1); });
'''

with sftp.file('/Users/fangjin/claude-code-inject.js', 'w') as f:
    f.write(inject_js)
print("inject.js v4 deployed (type:req fix)")

# Test
stdin, stdout, stderr = client.exec_command(
    '/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "test wake v4" wake 2>&1'
)
time.sleep(12)
result = stdout.read().decode().strip()
print(f"Wake test: {result}")

sftp.close()
client.close()
