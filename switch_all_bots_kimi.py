#!/usr/bin/env python3
"""Switch all 3 remaining bots to use claude-opus-4-6 (proxy → Gateway → Kimi)."""
import paramiko
import json

BOTS = {
    'aling': {
        'container': 'aling-gateway',
        'deploy_dir': '~/Desktop/p/docker-openclawd/deploy-aling',
    },
    'lain': {
        'container': 'lain-gateway',
        'deploy_dir': '~/Desktop/p/docker-openclawd/deploy-lain',
    },
    'lumi': {
        'container': 'lumi-gateway',
        'deploy_dir': '~/Desktop/p/docker-openclawd/deploy-lumi',
    },
}

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    config_path = '/home/node/.openclaw/openclaw.json'

    for name, bot in BOTS.items():
        container = bot['container']
        print(f'\n=== {name} ({container}) ===')

        # Read openclaw.json
        cmd = f'docker exec {container} cat {config_path}'
        stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
        raw = stdout.read().decode()
        err = stderr.read().decode()
        if err:
            print(f'  Read error: {err}')
            continue

        config = json.loads(raw)
        old_model = config.get('agents', {}).get('defaults', {}).get('model', {}).get('primary', '?')
        print(f'  Old primary: {old_model}')

        if old_model == 'claude-opus-4-6':
            print(f'  Already set, skipping')
            continue

        # Change primary model
        config['agents']['defaults']['model']['primary'] = 'claude-opus-4-6'

        # Write back
        new_json = json.dumps(config, indent=4)
        write_cmd = f"docker exec -i {container} tee {config_path} > /dev/null"
        stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
        stdin.write(new_json)
        stdin.channel.shutdown_write()
        stdout.read()
        err = stderr.read().decode()
        if err:
            print(f'  Write error: {err}')
        else:
            print(f'  Changed to: claude-opus-4-6')

    # Now update Gateway config to set all 3 bots to kimi provider
    print('\n=== Updating LLM Gateway config ===')
    cmd = 'cat ~/llm-gateway-v2/config.json'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
    gw_config = json.loads(stdout.read().decode())

    for bot_name in ['aling', 'lain', 'lumi']:
        old_provider = gw_config['bots'][bot_name].get('provider', '?')
        gw_config['bots'][bot_name]['provider'] = 'kimi'
        print(f'  {bot_name}: {old_provider} → kimi')

    new_gw_json = json.dumps(gw_config, indent=2)
    write_cmd = "tee ~/llm-gateway-v2/config.json > /dev/null"
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
    stdin.write(new_gw_json)
    stdin.channel.shutdown_write()
    stdout.read()
    print('  Gateway config updated')

    # Restart Gateway to pick up new config
    print('\n=== Restarting LLM Gateway ===')
    cmd = 'launchctl stop com.llm-gateway; sleep 3; launchctl start com.llm-gateway'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
    stdout.read()
    print('  Gateway restarted')

    # Restart all 3 bot containers
    print('\n=== Restarting bot containers ===')
    for name, bot in BOTS.items():
        deploy_dir = bot['deploy_dir']
        cmd = f'cd {deploy_dir} && docker compose restart'
        stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"', timeout=60)
        out = stdout.read().decode()
        err = stderr.read().decode()
        print(f'  {name}: {out.strip()} {err.strip()}')

    # Verify
    import time
    time.sleep(10)
    print('\n=== Verification ===')
    for name, bot in BOTS.items():
        container = bot['container']
        cmd = f'docker logs {container} --tail 3 2>&1'
        stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
        out = stdout.read().decode()
        if 'claude-opus-4-6' in out or 'anthropic/' in out:
            print(f'  {name}: OK (using anthropic/claude-opus-4-6)')
        elif 'listening' in out or 'telegram' in out.lower():
            print(f'  {name}: Running (checking model...)')
            cmd2 = f'docker logs {container} 2>&1 | grep "agent model"'
            stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd2}"')
            model_line = stdout.read().decode().strip()
            print(f'    {model_line}')
        else:
            print(f'  {name}: {out[:100]}')

    # Check Gateway
    cmd = 'curl -s http://127.0.0.1:8080/api/config | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\'  {k}: provider={v.get(\"provider\",\"?\")}\') for k,v in d[\"bots\"].items()]"'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd}"')
    out = stdout.read().decode()
    print(f'\nGateway bot providers:\n{out}')

    client.close()

if __name__ == '__main__':
    run()
