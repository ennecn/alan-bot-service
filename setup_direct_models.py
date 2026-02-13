#!/usr/bin/env python3
"""
Phase 1: Add models.providers and agents.defaults.model to all 4 bots' openclaw.json.
OpenClaw will auto-detect the file change and hot-reload (no restart needed).
"""
import paramiko
import json
import base64
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

CONTAINERS = [
    'deploy-openclaw-gateway-1',  # Alin
    'lain-gateway',
    'lumi-gateway',
    'aling-gateway',
]

CONFIG_PATH = '/home/node/.openclaw/openclaw.json'

# Model providers to inject
MODELS_SECTION = {
    "mode": "merge",
    "providers": {
        "antigravity": {
            "baseUrl": "http://138.68.44.141:8045/v1",
            "apiKey": "sk-antigravity-openclaw",
            "api": "openai-completions",
            "models": [{
                "id": "gemini-3-flash",
                "name": "Gemini 3 Flash",
                "reasoning": True,
                "input": ["text", "image"],
                "contextWindow": 1000000,
                "maxTokens": 65536,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
            }]
        },
        "codesome": {
            "baseUrl": "https://v3.codesome.cn",
            "apiKey": "sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8",
            "api": "anthropic-messages",
            "models": [{
                "id": "claude-opus-4-6",
                "name": "Claude Opus 4.6",
                "reasoning": True,
                "input": ["text", "image"],
                "contextWindow": 200000,
                "maxTokens": 16384,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
            }]
        },
        "t8star": {
            "baseUrl": "https://ai.t8star.cn",
            "apiKey": "sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW",
            "api": "anthropic-messages",
            "models": [{
                "id": "claude-opus-4-6",
                "name": "Claude Opus 4.6",
                "reasoning": True,
                "input": ["text", "image"],
                "contextWindow": 200000,
                "maxTokens": 16384,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
            }]
        }
    }
}

MODELS_ALLOWLIST = {
    "antigravity/gemini-3-flash": {"alias": "gemini"},
    "codesome/claude-opus-4-6": {"alias": "codesome"},
    "t8star/claude-opus-4-6": {"alias": "t8star"},
}

DEFAULT_MODEL = {"primary": "antigravity/gemini-3-flash"}


def run_cmd(client, cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    for container in CONTAINERS:
        print(f'\n{"="*60}')
        print(f'Processing: {container}')
        print(f'{"="*60}')

        # Read current config
        out, err = run_cmd(client, f'docker exec {container} cat {CONFIG_PATH}')
        if not out.strip():
            print(f'  ERROR: Could not read {CONFIG_PATH}')
            continue

        config = json.loads(out)

        # Add models section
        config['models'] = MODELS_SECTION

        # Update agents.defaults
        if 'agents' not in config:
            config['agents'] = {}
        if 'defaults' not in config['agents']:
            config['agents']['defaults'] = {}

        config['agents']['defaults']['model'] = DEFAULT_MODEL
        config['agents']['defaults']['models'] = MODELS_ALLOWLIST

        # Write back via base64 to avoid quoting issues
        new_json = json.dumps(config, indent=2, ensure_ascii=False)
        b64 = base64.b64encode(new_json.encode('utf-8')).decode()
        write_cmd = f'docker exec {container} sh -c "echo {b64} | base64 -d > {CONFIG_PATH}"'
        out, err = run_cmd(client, write_cmd)
        if err.strip():
            print(f'  Write error: {err.strip()}')
            continue

        # Verify
        out, _ = run_cmd(client, f'docker exec {container} cat {CONFIG_PATH}')
        verify = json.loads(out)
        model = verify.get('agents', {}).get('defaults', {}).get('model', {}).get('primary', 'NOT SET')
        providers = list(verify.get('models', {}).get('providers', {}).keys())
        print(f'  model.primary: {model}')
        print(f'  providers: {providers}')
        print(f'  OK!')

    client.close()
    print('\nDone! OpenClaw will auto-detect changes and hot-reload.')


if __name__ == '__main__':
    main()
