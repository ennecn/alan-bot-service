#!/usr/bin/env python3
import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

sftp = client.open_sftp()

# Read current settings
with sftp.file('/Users/fangjin/.claude/settings.json', 'r') as f:
    settings = json.load(f)

# Remove wrong key, add correct env var
settings.pop('enableAgentTeams', None)
settings['env']['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'] = '1'

with sftp.file('/Users/fangjin/.claude/settings.json', 'w') as f:
    f.write(json.dumps(settings, indent=2))

print(json.dumps(settings, indent=2))

sftp.close()
client.close()
