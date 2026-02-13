#!/usr/bin/env python3
"""Deploy Gateway V2 with Telegram notify feature to Mac Mini."""
import paramiko
import os
import time

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
REMOTE_DIR = '/Users/fangjin/llm-gateway-v2'

def run_cmd(client, cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    stdin, stdout, stderr = client.exec_command(cmd)
    return stdout.read().decode(), stderr.read().decode()

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    sftp = client.open_sftp()

    base = os.path.join(os.path.dirname(__file__), 'llm-gateway-v2')

    # Upload files
    for f in ['server.js', 'config.json']:
        local = os.path.join(base, f)
        remote = f'{REMOTE_DIR}/{f}'
        print(f'Uploading {f} ...')
        sftp.put(local, remote)

    local_html = os.path.join(base, 'public', 'index.html')
    remote_html = f'{REMOTE_DIR}/public/index.html'
    print('Uploading public/index.html ...')
    sftp.put(local_html, remote_html)

    sftp.close()

    # Restart
    print('\nRestarting Gateway V2 ...')
    run_cmd(client, 'launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist')
    time.sleep(1)
    run_cmd(client, 'launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist')
    time.sleep(2)

    # Verify
    out, _ = run_cmd(client, 'curl -s http://127.0.0.1:8080/health')
    print(f'Health: {out}')

    # Test notify endpoint
    print('\nTesting Telegram notification ...')
    out, _ = run_cmd(client, 'curl -s -X POST http://127.0.0.1:8080/api/notify-status')
    print(f'Notify response: {out}')

    client.close()
    print('\nDone!')

if __name__ == '__main__':
    main()
