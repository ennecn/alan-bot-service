#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    'find /opt/homebrew -name openclaw -type f 2>/dev/null',
    'find /usr/local -name openclaw -type f 2>/dev/null',
    'find ~/.npm-global -name openclaw -type f 2>/dev/null',
    'npm list -g --depth=0 2>/dev/null | grep openclaw',
    'ls /opt/homebrew/lib/node_modules/.bin/openclaw 2>/dev/null',
    'ls /opt/homebrew/bin/openclaw 2>/dev/null',
]
for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    if out:
        print(f"[{cmd}] → {out}")

# Also check if openclaw node is running (it was installed for Phase 2)
stdin, stdout, stderr = client.exec_command('launchctl list | grep openclaw 2>/dev/null')
out = stdout.read().decode().strip()
if out:
    print(f"[launchctl] → {out}")

# Check npm global
stdin, stdout, stderr = client.exec_command('export PATH=/opt/homebrew/bin:$PATH && npm root -g 2>/dev/null')
out = stdout.read().decode().strip()
print(f"[npm root -g] → {out}")

stdin, stdout, stderr = client.exec_command(f'ls {out}/.bin/openclaw 2>/dev/null' if out else 'echo none')
out2 = stdout.read().decode().strip()
print(f"[openclaw bin] → {out2}")

client.close()
