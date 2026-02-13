#!/usr/bin/env python3
"""List sessions to find session key format"""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

list_js = '''
const ws = new WebSocket("ws://127.0.0.1:18789");
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.event === "connect.challenge") {
    ws.send(JSON.stringify({
      type: "req", id: "c1", method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "gateway-client", version: "1.0.0", platform: "node", mode: "backend" },
        auth: { password: "openclaw123" }
      }
    }));
  }
  if (msg.id === "c1" && msg.ok) {
    ws.send(JSON.stringify({
      type: "req", id: "s1", method: "sessions.list", params: {}
    }));
  }
  if (msg.id === "s1") {
    const sessions = msg.payload?.sessions || msg.payload || [];
    if (Array.isArray(sessions)) {
      sessions.forEach(s => {
        console.log(JSON.stringify({ key: s.key, label: s.label, channel: s.channel, peer: s.peer, lastAt: s.lastActivityAt }));
      });
    } else {
      console.log(JSON.stringify(msg.payload, null, 2).substring(0, 3000));
    }
    ws.close();
    process.exit(0);
  }
});
ws.addEventListener("error", (e) => { console.error("ERROR:", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 10000);
'''

with sftp.file('/tmp/list-sessions.js', 'w') as f:
    f.write(list_js)

stdin, stdout, stderr = client.exec_command('/opt/homebrew/bin/node /tmp/list-sessions.js 2>&1')
time.sleep(12)
print(stdout.read().decode().strip())

sftp.close()
client.close()
