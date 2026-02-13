#!/usr/bin/env python3
"""Check compaction settings and cleanup mechanisms for all bots."""
import paramiko
import json
import sys

BASE = '/Users/fangjin/Desktop/p/docker-openclawd'
BOTS = [
    ('deploy', 'deploy-openclaw-gateway-1', 'Alin'),
    ('deploy-aling', 'aling-gateway', 'Aling'),
    ('deploy-lain', 'lain-gateway', 'Lain'),
    ('deploy-lumi', 'lumi-gateway', 'Lumi'),
]

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = c.open_sftp()

    for deploy_dir, container, name in BOTS:
        print(f"=== {name} ({container}) ===")

        # Read openclaw.json
        try:
            with sftp.open(f'{BASE}/{deploy_dir}/config/openclaw.json', 'r') as f:
                cfg = json.loads(f.read().decode())

            defaults = cfg.get('agents', {}).get('defaults', {})
            compaction = defaults.get('compaction', {})
            pruning = defaults.get('contextPruning', {})

            print(f"  compaction: {json.dumps(compaction)}")
            print(f"  contextPruning: {json.dumps(pruning)}")
        except Exception as ex:
            print(f"  Error reading config: {ex}")

        # Check for any cleanup/cron scripts
        _, o, e = c.exec_command(f'/usr/local/bin/docker exec {container} ls /home/node/.openclaw/cron* /home/node/.openclaw/cleanup* /home/node/.openclaw/scripts/ 2>&1')
        scripts = o.read().decode().strip()
        print(f"  cleanup scripts: {scripts}")

        # Check session files size
        _, o, e = c.exec_command(f'/usr/local/bin/docker exec {container} du -sh /home/node/.openclaw/sessions/ 2>/dev/null')
        sessions = o.read().decode().strip()
        print(f"  sessions dir size: {sessions}")

        # Check active sessions
        _, o, e = c.exec_command(f'/usr/local/bin/docker exec {container} wc -l /home/node/.openclaw/sessions/sessions.json 2>/dev/null')
        sess_count = o.read().decode().strip()
        print(f"  sessions.json lines: {sess_count}")

        # Check for any proactive-agent or heartbeat config
        heartbeat = defaults.get('heartbeat', {})
        print(f"  heartbeat: {json.dumps(heartbeat)}")

        print()

    sftp.close()
    c.close()

if __name__ == '__main__':
    main()
