#!/usr/bin/env python3
"""Test WebSocket inject by writing test script to file"""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

test_js = '''
const ws = new WebSocket("ws://127.0.0.1:18789");
ws.addEventListener("open", () => {
  console.log("CONNECTED");
  ws.send(JSON.stringify({id:"a1", method:"auth", params:{token:"mysecrettoken123"}}));
});
ws.addEventListener("message", (e) => {
  const raw = e.data.toString().substring(0, 500);
  console.log("MSG:", raw);
  try {
    const msg = JSON.parse(e.data);
    if (msg.id === "a1") {
      if (msg.error) {
        console.log("AUTH FAILED:", JSON.stringify(msg.error));
        ws.close();
        process.exit(1);
      }
      console.log("AUTH OK, sending inject...");
      ws.send(JSON.stringify({
        id: "i1",
        method: "chat.inject",
        params: { message: "[test] Claude Code inject test" }
      }));
    }
    if (msg.id === "i1") {
      console.log("INJECT RESULT:", JSON.stringify(msg));
      ws.close();
      process.exit(0);
    }
  } catch(e) {}
});
ws.addEventListener("error", (e) => console.log("ERROR:", e.message || e.type));
ws.addEventListener("close", (e) => { console.log("CLOSED:", e.code, e.reason); process.exit(0); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 10000);
'''

with sftp.file('/tmp/test-inject.js', 'w') as f:
    f.write(test_js)

stdin, stdout, stderr = client.exec_command('/opt/homebrew/bin/node /tmp/test-inject.js 2>&1')
time.sleep(12)
print(stdout.read().decode().strip())

sftp.close()
client.close()
