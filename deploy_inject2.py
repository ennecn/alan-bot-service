#!/usr/bin/env python3
"""Deploy proper WebSocket inject with correct connect handshake"""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# Check protocol version
stdin, stdout, stderr = client.exec_command(
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep "PROTOCOL_VERSION" /app/dist/client-BYVbRnuQ.js 2>/dev/null | head -3'
)
print(f"Protocol: {stdout.read().decode().strip()[:200]}")

# Check GatewayClientModeSchema
stdin, stdout, stderr = client.exec_command(
    '/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep "GatewayClientModeSchema\\|ClientMode" /app/dist/client-BYVbRnuQ.js 2>/dev/null | head -5'
)
print(f"ClientMode: {stdout.read().decode().strip()[:300]}")

inject_js = r'''#!/usr/bin/env node
// claude-code-inject.js v2 - Proper OpenClaw WebSocket handshake + wake/inject
const message = process.argv[2];
const method = process.argv[3] || "wake"; // "wake" or "inject"
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

    // Step 1: Receive challenge, send connect
    if (msg.type === "event" && msg.event === "connect.challenge") {
      step = "sending-connect";
      ws.send(JSON.stringify({
        id: "c1",
        method: "connect",
        params: {
          minProtocol: 1,
          maxProtocol: 1,
          client: {
            id: "hook-inject",
            version: "1.0.0",
            platform: "node-hook",
            mode: "control"
          },
          auth: { password: GATEWAY_PASSWORD }
        }
      }));
      return;
    }

    // Step 2: Connect response
    if (msg.id === "c1") {
      if (msg.error) {
        console.error("Connect failed:", JSON.stringify(msg.error));
        ws.close(); process.exit(1);
      }
      step = "connected";

      if (method === "wake") {
        ws.send(JSON.stringify({
          id: "w1",
          method: "wake",
          params: { mode: "now", text: message }
        }));
      } else {
        ws.send(JSON.stringify({
          id: "w1",
          method: "chat.inject",
          params: { message: message }
        }));
      }
      return;
    }

    // Step 3: Wake/inject response
    if (msg.id === "w1") {
      clearTimeout(timer);
      if (msg.error) {
        console.error("Failed:", JSON.stringify(msg.error));
        ws.close(); process.exit(1);
      }
      console.log("OK");
      ws.close(); process.exit(0);
    }
  } catch(e) {}
});

ws.addEventListener("error", (e) => { console.error("WS error:", e.message || e.type); process.exit(1); });
ws.addEventListener("close", () => { if (step !== "done") process.exit(1); });
'''

with sftp.file('/Users/fangjin/claude-code-inject.js', 'w') as f:
    f.write(inject_js)
print("\ninject.js v2 deployed")

# Test wake
stdin, stdout, stderr = client.exec_command(
    '/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "test wake from hook" wake 2>&1'
)
time.sleep(12)
result = stdout.read().decode().strip()
print(f"Wake test: {result}")

sftp.close()
client.close()
