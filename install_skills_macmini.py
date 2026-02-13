#!/usr/bin/env python3
"""Upload and install skills bundle to Mac Mini's Claude Code."""
import paramiko
import os

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
BUNDLE = r'D:\openclawVPS\tmp-skills\skills-bundle.tar.gz'
REMOTE_SKILLS = '/Users/fangjin/.claude/skills'

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    rc = stdout.channel.recv_exit_status()
    return out, err, rc

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Create skills dir
    ssh_exec(client, f'mkdir -p {REMOTE_SKILLS}')

    # Upload bundle
    print("[1] Uploading skills bundle...")
    sftp = client.open_sftp()
    sftp.put(BUNDLE, '/tmp/skills-bundle.tar.gz')
    sftp.close()
    print("    Uploaded to /tmp/skills-bundle.tar.gz")

    # Extract
    print("[2] Extracting skills...")
    out, err, rc = ssh_exec(client, f'cd {REMOTE_SKILLS} && tar xzf /tmp/skills-bundle.tar.gz')
    if rc != 0:
        print(f"    ERROR: {err}")
    else:
        print("    Extracted successfully")

    # Check ui-ux-pro-max needs SKILL.md
    out, _, _ = ssh_exec(client, f'test -f {REMOTE_SKILLS}/ui-ux-pro-max/SKILL.md && echo exists || echo missing')
    if 'missing' in out:
        print("[3] Copying SKILL.md for ui-ux-pro-max from bot's installation...")
        src = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/config/skills/ui-ux-pro-max/SKILL.md'
        out, _, rc = ssh_exec(client, f'cp {src} {REMOTE_SKILLS}/ui-ux-pro-max/SKILL.md')
        if rc == 0:
            print("    Copied SKILL.md")
        else:
            print(f"    ERROR copying SKILL.md")

    # Verify
    print("\n[4] Installed skills:")
    out, _, _ = ssh_exec(client, f'ls {REMOTE_SKILLS}')
    for skill in out.strip().split('\n'):
        has_md, _, _ = ssh_exec(client, f'test -f {REMOTE_SKILLS}/{skill}/SKILL.md && echo yes || echo no')
        print(f"    {skill} {'✓' if 'yes' in has_md else '✗ (no SKILL.md)'}")

    # Cleanup
    ssh_exec(client, 'rm /tmp/skills-bundle.tar.gz')
    print("\nDone!")
    client.close()

if __name__ == '__main__':
    main()
