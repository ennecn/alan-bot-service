#!/usr/bin/env python3
import paramiko
import json

def run_cmd(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()
    if out:
        print(f"[OUT] {out.strip()}")
    if err:
        print(f"[ERR] {err.strip()}")
    return out.strip(), err.strip(), exit_code

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# 1. Update .bash_profile with correct values
bash_profile_content = '''export ANTHROPIC_BASE_URL="https://v3.codesome.cn"
export ANTHROPIC_AUTH_TOKEN="sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8"
'''
sftp = client.open_sftp()
with sftp.file('/Users/fangjin/.bash_profile', 'w') as f:
    f.write(bash_profile_content)
print("[OK] Updated .bash_profile")

# 2. Read current settings.json
with sftp.file('/Users/fangjin/.claude/settings.json', 'r') as f:
    settings = json.load(f)
print(f"[OK] Current settings: {json.dumps(settings, indent=2)}")

# 3. Update settings.json - add env and enable agent teams
settings['env'] = {
    'ANTHROPIC_BASE_URL': 'https://v3.codesome.cn',
    'ANTHROPIC_API_KEY': 'sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8'
}
settings['enableAgentTeams'] = True

with sftp.file('/Users/fangjin/.claude/settings.json', 'w') as f:
    f.write(json.dumps(settings, indent=2))
print(f"[OK] Updated settings.json: {json.dumps(settings, indent=2)}")

sftp.close()

# 4. Check Claude Code version
run_cmd(client, 'export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:$PATH && claude --version')

# 5. Verify settings
run_cmd(client, 'cat /Users/fangjin/.claude/settings.json')
run_cmd(client, 'cat /Users/fangjin/.bash_profile')

client.close()
print("\n[DONE] All configuration updated.")
