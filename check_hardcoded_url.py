#!/usr/bin/env python3
"""Check if pi-ai has hardcoded API URL."""
import paramiko, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

DOCKER = '/usr/local/bin/docker'
MODELS_JS = '/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/models.generated.js'

# Check script
check_script = f'''
const fs = require('fs');
const content = fs.readFileSync('{MODELS_JS}', 'utf-8');
const lines = content.split('\\n');
for (let i = 0; i < lines.length; i++) {{
  if (lines[i].includes('api.anthropic.com') || lines[i].includes('baseUrl')) {{
    console.log((i+1) + ': ' + lines[i].trim().substring(0, 120));
  }}
}}
console.log('\\nTotal occurrences of api.anthropic.com:', (content.match(/api\\.anthropic\\.com/g) || []).length);
'''

# Write and execute
sftp = mac.open_sftp()
with sftp.open('/tmp/check_url.js', 'w') as f:
    f.write(check_script)
sftp.close()

stdin, stdout, stderr = mac.exec_command(f'{DOCKER} cp /tmp/check_url.js deploy-openclaw-gateway-1:/tmp/check_url.js && {DOCKER} exec deploy-openclaw-gateway-1 node /tmp/check_url.js', timeout=10)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err:
    print(f"Error: {err}")

mac.close()
