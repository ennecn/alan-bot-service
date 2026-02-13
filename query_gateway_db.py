#!/usr/bin/env python3
import paramiko
import sys
import io

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

JS_CODE = """
const Database = require('better-sqlite3');
const db = new Database('./data/gateway.db');
console.log('=== CLIENTS ===');
db.prepare('SELECT * FROM clients').all().forEach(c => console.log(JSON.stringify(c)));
console.log('=== PROVIDERS ===');
db.prepare('SELECT id,name,base_url,api_format,route_type,priority,enabled,supported_models,model_mapping FROM providers').all().forEach(p => console.log(JSON.stringify(p)));
db.close();
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

# Upload JS file via SFTP
sftp = client.open_sftp()
with sftp.file('/Users/fangjin/llm-gateway/query_tmp.cjs', 'w') as f:
    f.write(JS_CODE)
sftp.close()

# Execute
stdin, stdout, stderr = client.exec_command(
    'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && cd /Users/fangjin/llm-gateway && node query_tmp.cjs',
    timeout=15
)
out = stdout.read().decode()
err = stderr.read().decode()
client.close()

if out:
    print(out)
if err:
    print(err, file=sys.stderr)
