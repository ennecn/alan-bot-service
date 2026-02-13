#!/usr/bin/env python3
"""Update compaction maxHistoryShare from 0.2 to 0.35 on all OpenClaw bots."""
import paramiko
import json
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

CONTAINERS = [
    'deploy-openclaw-gateway-1',  # Alin
    'lain-gateway',
    'lumi-gateway',
    'aling-gateway',
]

NEW_MAX_HISTORY_SHARE = 0.35

def run_cmd(client, cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    for container in CONTAINERS:
        print(f'\n{"="*50}')
        print(f'Processing: {container}')
        print(f'{"="*50}')

        # Read current config
        out, err = run_cmd(client, f'docker exec {container} cat /home/node/.openclaw/openclaw.json')
        if not out.strip():
            print(f'  WARNING: Could not read openclaw.json from {container}')
            continue

        try:
            config = json.loads(out)
        except json.JSONDecodeError as e:
            print(f'  ERROR: Invalid JSON: {e}')
            continue

        # Show current value
        current = config.get('agents', {}).get('defaults', {}).get('compaction', {}).get('maxHistoryShare', 'NOT SET')
        print(f'  Current maxHistoryShare: {current}')

        # Update
        if 'agents' not in config:
            config['agents'] = {}
        if 'defaults' not in config['agents']:
            config['agents']['defaults'] = {}
        if 'compaction' not in config['agents']['defaults']:
            config['agents']['defaults']['compaction'] = {'mode': 'safeguard'}

        config['agents']['defaults']['compaction']['maxHistoryShare'] = NEW_MAX_HISTORY_SHARE
        print(f'  New maxHistoryShare: {NEW_MAX_HISTORY_SHARE}')

        # Write back
        new_json = json.dumps(config, indent=2, ensure_ascii=False)
        # Escape for shell - use base64 to avoid quoting issues
        import base64
        b64 = base64.b64encode(new_json.encode()).decode()

        write_cmd = f'docker exec {container} sh -c "echo {b64} | base64 -d > /home/node/.openclaw/openclaw.json"'
        out, err = run_cmd(client, write_cmd)
        if err.strip():
            print(f'  Write error: {err.strip()}')

        # Verify
        out, err = run_cmd(client, f'docker exec {container} cat /home/node/.openclaw/openclaw.json')
        try:
            verify = json.loads(out)
            verify_val = verify.get('agents', {}).get('defaults', {}).get('compaction', {}).get('maxHistoryShare')
            if verify_val == NEW_MAX_HISTORY_SHARE:
                print(f'  VERIFIED: maxHistoryShare = {verify_val}')
            else:
                print(f'  MISMATCH: got {verify_val}, expected {NEW_MAX_HISTORY_SHARE}')
        except:
            print(f'  ERROR: Could not verify config')

    # Restart all containers
    print(f'\n{"="*50}')
    print('Restarting all bot containers...')
    print(f'{"="*50}')
    for container in CONTAINERS:
        print(f'  Restarting {container}...')
        out, err = run_cmd(client, f'docker restart {container}')
        print(f'    {out.strip() or err.strip()}')

    # Wait and verify
    import time
    print('\nWaiting 10s for containers to start...')
    time.sleep(10)

    print('\nVerifying containers are running:')
    out, err = run_cmd(client, 'docker ps --format "table {{.Names}}\\t{{.Status}}"')
    print(out)

    client.close()
    print('Done!')

if __name__ == '__main__':
    main()
