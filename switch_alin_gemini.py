#!/usr/bin/env python3
"""Switch Alin's model to Gemini 3 Flash via Antigravity by updating Gateway DB."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

JS_CODE = """
const Database = require('better-sqlite3');
const db = new Database('./data/gateway.db');

// Update Alin (id=4): set provider_order to Antigravity only
db.prepare("UPDATE clients SET provider_order = '[1]' WHERE id = 4").run();

// Verify
const alin = db.prepare("SELECT id, name, provider_order, model_mapping FROM clients WHERE id = 4").get();
console.log('Updated Alin:', JSON.stringify(alin, null, 2));

// Show Antigravity provider info for reference
const ag = db.prepare("SELECT name, model_mapping FROM providers WHERE id = 1").get();
console.log('Antigravity model_mapping:', ag.model_mapping);

db.close();
console.log('Done! Alin will now route all requests through Antigravity (Gemini 3 Flash).');
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

sftp = client.open_sftp()
with sftp.file('/Users/fangjin/llm-gateway/switch_alin.cjs', 'w') as f:
    f.write(JS_CODE)
sftp.close()

stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && cd /Users/fangjin/llm-gateway && node switch_alin.cjs',
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
