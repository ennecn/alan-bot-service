#!/usr/bin/env python3
"""Upload SKILL.md to all 4 bots via SFTP"""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

with open(r'D:\openclawVPS\skill_template.md', 'r', encoding='utf-8') as f:
    template = f.read()

bots = {
    'alin':  {'port': '18789', 'workdir': 'alin',  'path': '/Users/fangjin/Desktop/p/docker-openclawd/deploy/config/skills/claude-code/SKILL.md'},
    'aling': {'port': '18791', 'workdir': 'aling', 'path': '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling/config/skills/claude-code/SKILL.md'},
    'lain':  {'port': '18790', 'workdir': 'lain',  'path': '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lain/config/skills/claude-code/SKILL.md'},
    'lumi':  {'port': '18792', 'workdir': 'lumi',  'path': '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lumi/config/skills/claude-code/SKILL.md'},
}

for name, cfg in bots.items():
    content = template.replace('PORT_PLACEHOLDER', cfg['port']).replace('WORKDIR_PLACEHOLDER', cfg['workdir'])
    data = content.encode('utf-8')
    with sftp.open(cfg['path'], 'wb') as f:
        f.write(data)
    print(f"{name}: {len(data)} bytes")

# Verify
for name, cfg in bots.items():
    with sftp.open(cfg['path'], 'r') as f:
        check = f.read().decode('utf-8')
    has_port = cfg['port'] in check
    has_wd = cfg['workdir'] in check
    has_bt = '```' in check
    has_nodes = 'nodes' in check
    print(f"{name} verify: port={has_port} workdir={has_wd} backticks={has_bt} nodes={has_nodes}")

sftp.close()
client.close()
