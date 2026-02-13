#!/usr/bin/env python3
"""Reset 阿凛's session - fix for dict-format sessions.json."""
import paramiko
import json

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    session_key = 'agent:main:telegram:dm:6564284621'
    sessions_dir = '/home/node/.openclaw/agents/main/sessions'
    container = 'deploy-openclaw-gateway-1'

    # Read sessions.json
    cmd = f'docker exec {container} cat {sessions_dir}/sessions.json'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
    sessions_json = stdout.read().decode()
    sessions = json.loads(sessions_json)
    print(f'Before: {len(sessions)} session keys')
    print(f'Keys: {list(sessions.keys())}')

    # Remove the session entry
    if session_key in sessions:
        del sessions[session_key]
        print(f'Removed key: {session_key}')
    else:
        print(f'Key not found: {session_key}')

    print(f'After: {len(sessions)} session keys')

    # Write back
    new_json = json.dumps(sessions, indent=2)
    cmd2 = f"docker exec -i {container} tee {sessions_dir}/sessions.json > /dev/null"
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd2}"')
    stdin.write(new_json)
    stdin.channel.shutdown_write()
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err:
        print(f'Write error: {err}')
    else:
        print('sessions.json updated')

    # Verify
    cmd3 = f'docker exec {container} ls -lh {sessions_dir}/'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd3}"')
    out = stdout.read().decode()
    print(f'Files:\n{out}')

    client.close()

if __name__ == '__main__':
    run()
