#!/usr/bin/env python3
"""
Deploy the refactored Gateway V2 (now Config Manager) to Mac Mini.
Uploads: server.js, config.json, public/index.html
Restarts: llm-gateway-v2 via launchctl
"""
import paramiko
import sys
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
REMOTE_DIR = '/Users/fangjin/llm-gateway-v2'
LOCAL_DIR = os.path.join(os.path.dirname(__file__), 'llm-gateway-v2')

PLIST = 'com.llm-gateway-v2.plist'

FILES = [
    ('server.js', 'server.js'),
    ('config.json', 'config.json'),
    (os.path.join('public', 'index.html'), os.path.join('public', 'index.html')),
]


def run_cmd(client, cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err


def main():
    print('Connecting to Mac Mini...')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    sftp = client.open_sftp()

    # Ensure remote directories exist
    for d in [REMOTE_DIR, os.path.join(REMOTE_DIR, 'public')]:
        remote_d = d.replace('\\', '/')
        try:
            sftp.stat(remote_d)
        except FileNotFoundError:
            sftp.mkdir(remote_d)
            print(f'  Created {remote_d}')

    # Upload files
    for local_rel, remote_rel in FILES:
        local_path = os.path.join(LOCAL_DIR, local_rel)
        remote_path = f'{REMOTE_DIR}/{remote_rel}'.replace('\\', '/')
        print(f'  Uploading {local_rel} -> {remote_path}')
        sftp.put(local_path, remote_path)

    sftp.close()

    # Restart service
    print('\nRestarting Gateway V2...')
    out, err = run_cmd(client, f'launchctl unload ~/Library/LaunchAgents/{PLIST} 2>&1; sleep 1; launchctl load ~/Library/LaunchAgents/{PLIST}')
    print(f'  {out.strip()} {err.strip()}'.strip())

    # Wait a moment and check
    import time
    time.sleep(2)

    print('\nVerifying...')
    out, err = run_cmd(client, 'curl -s http://127.0.0.1:8080/health')
    print(f'  Health check: {out.strip()}')

    out, err = run_cmd(client, 'curl -s http://127.0.0.1:8080/api/status')
    print(f'  Status: {out.strip()[:200]}')

    # Test reading bot status from containers
    print('\nTesting /api/bots (reads from containers via docker exec)...')
    out, err = run_cmd(client, 'curl -s http://127.0.0.1:8080/api/bots')
    print(f'  Bots: {out.strip()[:500]}')

    client.close()
    print('\nDeploy complete!')


if __name__ == '__main__':
    main()
