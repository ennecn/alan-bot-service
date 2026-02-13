#!/usr/bin/env python3
"""Fix 阿凛's primary model to route through proxy → Gateway → Kimi."""
import paramiko
import json

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    container = 'deploy-openclaw-gateway-1'
    config_path = '/home/node/.openclaw/openclaw.json'

    # Read current config
    cmd = f'docker exec {container} cat {config_path}'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
    config = json.loads(stdout.read().decode())

    # Change primary model from antigravity/gemini-3-flash to claude-opus-4-6
    old_model = config['agents']['defaults']['model']['primary']
    config['agents']['defaults']['model']['primary'] = 'claude-opus-4-6'
    print(f'Changed primary model: {old_model} → claude-opus-4-6')

    # Write back
    new_json = json.dumps(config, indent=4)
    write_cmd = f"docker exec -i {container} tee {config_path} > /dev/null"
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
    stdin.write(new_json)
    stdin.channel.shutdown_write()
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err:
        print(f'Write error: {err}')
    else:
        print('openclaw.json updated')

    # Verify
    cmd2 = f'docker exec {container} cat {config_path} | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[\'agents\'][\'defaults\'][\'model\'])"'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd2}"')
    out = stdout.read().decode()
    print(f'Verified: {out}')

    client.close()

if __name__ == '__main__':
    run()
