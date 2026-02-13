#!/usr/bin/env python3
"""Deploy updated Gateway V2 with token usage stats to Mac Mini."""
import paramiko
import sys
import os

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
REMOTE_DIR = '/Users/fangjin/llm-gateway-v2'

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    sftp = client.open_sftp()

    # Upload server.js
    local_server = os.path.join(os.path.dirname(__file__), 'llm-gateway-v2', 'server.js')
    remote_server = f'{REMOTE_DIR}/server.js'
    print(f'Uploading server.js ...')
    sftp.put(local_server, remote_server)
    print(f'  -> {remote_server}')

    # Upload index.html
    local_html = os.path.join(os.path.dirname(__file__), 'llm-gateway-v2', 'public', 'index.html')
    remote_html = f'{REMOTE_DIR}/public/index.html'
    print(f'Uploading public/index.html ...')
    sftp.put(local_html, remote_html)
    print(f'  -> {remote_html}')

    sftp.close()

    # Restart Gateway V2 via launchctl
    print('\nRestarting Gateway V2 ...')
    restart_cmd = 'launchctl unload ~/Library/LaunchAgents/com.llm-gateway-v2.plist 2>/dev/null; sleep 1; launchctl load ~/Library/LaunchAgents/com.llm-gateway-v2.plist'
    stdin, stdout, stderr = client.exec_command(restart_cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)

    # Wait and verify
    import time
    time.sleep(2)
    print('\nVerifying Gateway V2 is running ...')
    stdin, stdout, stderr = client.exec_command('curl -s http://127.0.0.1:8080/health')
    out = stdout.read().decode()
    print(f'Health check: {out}')

    # Test stats endpoint
    stdin, stdout, stderr = client.exec_command('curl -s http://127.0.0.1:8080/api/stats')
    out = stdout.read().decode()
    print(f'Stats endpoint: {out[:200]}')

    # Check logs for startup
    stdin, stdout, stderr = client.exec_command('tail -5 /tmp/llm-gateway-v2.log 2>/dev/null || echo "No log file found"')
    out = stdout.read().decode()
    print(f'\nRecent logs:\n{out}')

    client.close()
    print('\nDone!')

if __name__ == '__main__':
    main()
