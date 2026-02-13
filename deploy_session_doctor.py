#!/usr/bin/env python3
"""Deploy session-doctor skill to all 4 OpenClaw bots."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
BASE = '/Users/fangjin/Desktop/p/docker-openclawd'

BOTS = [
    {"name": "Alin", "dir": "deploy"},
    {"name": "Aling", "dir": "deploy-aling"},
    {"name": "Lain", "dir": "deploy-lain"},
    {"name": "Lumi", "dir": "deploy-lumi"},
]

# Read local skill file
with open(r'D:\openclawVPS\session-doctor-SKILL.md', 'r', encoding='utf-8') as f:
    content = f.read()

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)
sftp = client.open_sftp()

for bot in BOTS:
    skill_dir = f"{BASE}/{bot['dir']}/config/skills/session-doctor"
    skill_path = f"{skill_dir}/SKILL.md"

    # Create directory
    try:
        sftp.mkdir(skill_dir)
    except IOError:
        pass  # already exists

    # Write skill file
    with sftp.open(skill_path, 'w') as f:
        f.write(content)

    print(f"{bot['name']}: deployed to {skill_dir}/")

sftp.close()
client.close()
print("\nAll done! Skills will be picked up on next bot interaction (no restart needed).")
