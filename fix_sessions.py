#!/usr/bin/env python3
import paramiko
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'
P = 'export PATH=/usr/local/bin:/usr/bin:/bin'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

# Use python3 inside the container to update sessions.json
py_script = r"""
import json
path = "/home/node/.openclaw/agents/main/sessions/sessions.json"
with open(path, "r") as f:
    d = json.load(f)
k = "agent:main:telegram:dm:6564284621"
if k in d:
    print("Found and removing:", k)
    del d[k]
    with open(path, "w") as f:
        json.dump(d, f)
    print("Done - entry removed")
else:
    print("Key not found:", k)
"""

# Write the script to a temp file in container, then execute it
cmd = f"""{P} && docker exec {CONTAINER} sh -c 'cat > /tmp/fix_sessions.py << PYEOF
{py_script}
PYEOF
python3 /tmp/fix_sessions.py'"""

stdin, stdout, stderr = client.exec_command(cmd)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print("OUT:", out)
if err:
    print("ERR:", err)
client.close()
