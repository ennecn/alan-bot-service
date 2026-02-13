#!/usr/bin/env python3
"""Deploy Gateway V2 with Gemini native tool call fix to Mac Mini."""
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

    local_server = os.path.join(os.path.dirname(__file__), 'llm-gateway-v2', 'server.js')
    print('Uploading server.js ...')
    sftp.put(local_server, f'{REMOTE_DIR}/server.js')
    sftp.close()

    # Restart
    print('Restarting Gateway V2 ...')
    run_cmd(client, 'launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist')
    time.sleep(1)
    run_cmd(client, 'launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist')
    time.sleep(2)

    out, _ = run_cmd(client, 'curl -s http://127.0.0.1:8080/health')
    print(f'Health: {out}')

    # Check last few log lines
    out, _ = run_cmd(client, 'tail -5 /private/tmp/gateway-v2.log')
    print(f'Logs:\n{out}')

    client.close()
    print('Done! Gemini native tool call fix deployed.')

if __name__ == '__main__':
    main()
