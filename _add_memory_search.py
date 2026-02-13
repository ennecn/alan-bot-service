#!/usr/bin/env python3
"""Add memorySearch config to Alin's openclaw.json only."""
import paramiko, sys, io, json, base64
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'  # Alin
CONFIG_PATH = '/home/node/.openclaw/openclaw.json'

MEMORY_SEARCH_CONFIG = {
    "sources": ["memory", "sessions"],
    "experimental": {
        "sessionMemory": True
    },
    "provider": "gemini",
    "remote": {
        "apiKey": "AIzaSyAG15eG4RIr7l-DPuDT2jUL5Lk8uHVpZUE"
    },
    "fallback": "gemini",
    "model": "gemini-embedding-001",
    "query": {
        "hybrid": {
            "enabled": True,
            "vectorWeight": 0.7,
            "textWeight": 0.3
        }
    }
}

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=15)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# Read current config
out, _ = run(f'docker exec {CONTAINER} cat {CONFIG_PATH}')
config = json.loads(out)

# Add memorySearch
config['agents']['defaults']['memorySearch'] = MEMORY_SEARCH_CONFIG

# Write back
new_json = json.dumps(config, indent=2, ensure_ascii=False)
b64 = base64.b64encode(new_json.encode('utf-8')).decode()
run(f'docker exec {CONTAINER} sh -c "echo {b64} | base64 -d > {CONFIG_PATH}"')

# Verify
out, _ = run(f'docker exec {CONTAINER} cat {CONFIG_PATH}')
verify = json.loads(out)
has_mem = 'memorySearch' in verify.get('agents', {}).get('defaults', {})
provider = verify['agents']['defaults'].get('memorySearch', {}).get('provider', 'N/A')
model = verify['agents']['defaults'].get('memorySearch', {}).get('model', 'N/A')
print(f'Alin memorySearch: {has_mem}')
print(f'  provider: {provider}')
print(f'  model: {model}')
print(f'  sources: {verify["agents"]["defaults"]["memorySearch"].get("sources")}')
print(f'  sessionMemory: {verify["agents"]["defaults"]["memorySearch"].get("experimental", {}).get("sessionMemory")}')

client.close()
print('\nDone! OpenClaw will hot-reload.')
