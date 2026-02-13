#!/usr/bin/env python3
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

containers = ['deploy-openclaw-gateway-1', 'lain-gateway', 'lumi-gateway', 'aling-gateway']
for c in containers:
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && docker exec {c} cat /home/node/.openclaw/openclaw.json'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    config = json.loads(out)
    # Check if models section exists
    has_models = 'models' in config
    # Check current agent model setting
    agent_model = config.get('agents', {}).get('defaults', {}).get('model', 'NOT SET')
    agent_models_list = config.get('agents', {}).get('defaults', {}).get('models', 'NOT SET')
    print(f"\n=== {c} ===")
    print(f"  has models section: {has_models}")
    print(f"  agents.defaults.model: {agent_model}")
    print(f"  agents.defaults.models (allowlist): {json.dumps(agent_models_list, ensure_ascii=False)[:200] if agent_models_list != 'NOT SET' else 'NOT SET'}")

# Also check: can Gateway V2 run docker exec?
print("\n=== Gateway V2 Docker access ===")
cmd = 'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && which docker && docker ps --format "{{.Names}}" 2>&1'
stdin, stdout, stderr = client.exec_command(cmd)
print(stdout.read().decode())

client.close()
