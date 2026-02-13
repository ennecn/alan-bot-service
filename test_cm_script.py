#!/usr/bin/env python3
import paramiko, json, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# Write test script to Mac Mini
test_script = '''#!/bin/bash
export PATH=/opt/homebrew/bin:/Users/fangjin/.local/bin:$PATH

echo "=== Process on port 37777 ==="
lsof -i :37777 | head -5

echo ""
echo "=== Save test ==="
RESP=$(curl -s -w "\\nHTTP:%{http_code}" -X POST http://127.0.0.1:37777/api/memory/save \
  -H "Content-Type: application/json" \
  -d '{"text":"Test: OpenClaw uses Kimi for LLM routing","title":"Kimi Test","project":"openclaw"}')
echo "$RESP"

sleep 2

echo ""
echo "=== Search test ==="
curl -s "http://127.0.0.1:37777/api/search?query=kimi&limit=5"

echo ""
echo ""
echo "=== Observations ==="
curl -s "http://127.0.0.1:37777/api/observations?limit=5"

echo ""
echo ""
echo "=== Stats ==="
curl -s "http://127.0.0.1:37777/api/stats"
'''

with sftp.open('/tmp/test-claude-mem.sh', 'w') as f:
    f.write(test_script)

_, stdout, stderr = client.exec_command('bash /tmp/test-claude-mem.sh')
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print(out)
if err:
    print(f"STDERR: {err[:500]}")

sftp.close()
client.close()
