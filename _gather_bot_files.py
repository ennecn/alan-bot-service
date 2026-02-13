#!/usr/bin/env python3
"""SSH into Mac Mini and gather bot config files from deploy-lain, deploy-lumi, deploy-aling."""
import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USERNAME = 'fangjin'
PASSWORD = 'YYZZ54321!'
BASE = '/Users/fangjin/Desktop/p/docker-openclawd'

BOTS = ['deploy-lain', 'deploy-lumi', 'deploy-aling']


def run(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f'Connecting to {HOST} as {USERNAME}...')
        client.connect(HOST, port=22, username=USERNAME, password=PASSWORD, timeout=15)
        print('Connected.\n')
    except Exception as e:
        print(f'SSH connection failed: {e}')
        sys.exit(1)

    for bot in BOTS:
        label = bot.replace('deploy-', '').upper()
        path = f'{BASE}/{bot}'

        print('=' * 80)
        print(f'  BOT: {label}  ({path})')
        print('=' * 80)

        # 1. docker-compose.yml (full)
        print('\n--- docker-compose.yml (full) ---')
        out, _ = run(client, f'cat {path}/docker-compose.yml 2>/dev/null')
        if not out:
            out, _ = run(client, f'cat {path}/docker-compose.yaml 2>/dev/null')
        print(out if out else '(not found)')

        # 2. .env (full)
        print('\n--- .env (full) ---')
        out, _ = run(client, f'cat {path}/.env 2>/dev/null')
        print(out if out else '(not found)')

        # 3. start.sh (full)
        print('\n--- start.sh (full) ---')
        out, _ = run(client, f'cat {path}/start.sh 2>/dev/null')
        print(out if out else '(not found)')

        # 4. api-proxy.js (first 30 lines only)
        print('\n--- api-proxy.js (first 30 lines) ---')
        out, _ = run(client, f'head -30 {path}/api-proxy.js 2>/dev/null')
        print(out if out else '(not found)')

        print('\n')

    client.close()
    print('=' * 80)
    print('  GATHER COMPLETE')
    print('=' * 80)


if __name__ == '__main__':
    main()
