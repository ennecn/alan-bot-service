#!/usr/bin/env python3
"""Debug: log all WS messages"""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

debug_js = r'''
const ws = new WebSocket("ws://127.0.0.1:18789");
let msgCount = 0;
ws.addEventListener("open", () => console.log("OPEN"));
ws.addEventListener("message", (e) => {
  msgCount++;
  const raw = e.data.toString();
  console.log("MSG#" + msgCount + ":", raw.substring(0, 300));
  if (msgCount === 1) {
    // Send connect after challenge
    ws.send(JSON.stringify({
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
        auth: { password: "openclaw123" }
      }
    }));
    console.log("SENT connect");
  }
});
ws.addEventListener("error", (e) => console.log("ERROR:", e.message || e.type));
ws.addEventListener("close", (e) => { console.log("CLOSED:", e.code, e.reason); process.exit(0); });
setTimeout(() => { console.log("DONE (timeout)"); ws.close(); process.exit(0); }, 8000);
'''

with sftp.file('/tmp/debug-ws.js', 'w') as f:
    f.write(debug_js)

stdin, stdout, stderr = client.exec_command('/opt/homebrew/bin/node /tmp/debug-ws.js 2>&1')
time.sleep(10)
print(stdout.read().decode().strip())

sftp.close()
client.close()
