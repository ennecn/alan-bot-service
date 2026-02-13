#!/usr/bin/env python3
"""Check Gateway request logs to verify Alin is using Antigravity/Gemini 3 Flash."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

JS_CODE = r"""
const Database = require('better-sqlite3');
const db = new Database('./data/gateway.db');

// First check table schema
const cols = db.prepare("PRAGMA table_info(request_logs)").all();
console.log('Columns:', cols.map(c => c.name).join(', '));

// Get last 5 requests for Alin
const logs = db.prepare(
    "SELECT * FROM request_logs WHERE client_name = 'Alin' ORDER BY id DESC LIMIT 5"
).all();

if (logs.length === 0) {
    const all = db.prepare("SELECT * FROM request_logs ORDER BY id DESC LIMIT 5").all();
    console.log('No Alin logs. Last 5 requests:');
    all.forEach(r => console.log(JSON.stringify(r)));
} else {
    console.log('Last 5 Alin requests:');
    logs.forEach(r => console.log(JSON.stringify(r)));
}

db.close();
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

sftp = client.open_sftp()
with sftp.file('/Users/fangjin/llm-gateway/check_logs.cjs', 'w') as f:
    f.write(JS_CODE)
sftp.close()

stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && cd /Users/fangjin/llm-gateway && node check_logs.cjs',
    timeout=15
)
out = stdout.read().decode()
err = stderr.read().decode()
client.close()

if out:
    print(out)
if err:
    import sys
    print(err, file=sys.stderr)
