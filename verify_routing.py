#!/usr/bin/env python3
"""Verify the complete model routing chain for all OpenClaw bots."""
import paramiko
import json

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    print("=" * 60)
    print("STEP 1: What model does the bot send? (api-proxy logs)")
    print("=" * 60)
    _, o, e = c.exec_command('/usr/local/bin/docker logs deploy-openclaw-gateway-1 --tail 500 2>&1')
    logs = o.read().decode('utf-8', errors='replace')
    for line in logs.split('\n'):
        if 'model=' in line and 'alin' in line.lower():
            print(f"  {line.strip()}")
    # Also check for any proxy log lines
    for line in logs.split('\n'):
        if '[Proxy]' in line or 'gw-alin' in line:
            print(f"  {line.strip()}")

    print()
    print("=" * 60)
    print("STEP 2: models.generated.js baseUrl (is it patched?)")
    print("=" * 60)
    _, o, e = c.exec_command('/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -o "baseUrl:.*" /app/node_modules/.pnpm/@mariozechner+pi-ai@*/node_modules/@mariozechner/pi-ai/dist/models.generated.js 2>/dev/null | head -5')
    print(f"  {o.read().decode('utf-8', errors='replace').strip()}")

    print()
    print("=" * 60)
    print("STEP 3: openclaw.json providers (direct routing config)")
    print("=" * 60)
    _, o, e = c.exec_command('/usr/local/bin/docker exec deploy-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json')
    try:
        cfg = json.loads(o.read().decode())
        providers = cfg.get('models', {}).get('providers', {})
        for name, p in providers.items():
            print(f"  {name}: baseUrl={p.get('baseUrl')}, api={p.get('api')}, models={[m['id'] for m in p.get('models', [])]}")
        primary = cfg.get('agents', {}).get('defaults', {}).get('model', {}).get('primary')
        print(f"  Primary model: {primary}")
    except Exception as ex:
        print(f"  Error: {ex}")

    print()
    print("=" * 60)
    print("STEP 4: api-proxy.js routing (where does it forward?)")
    print("=" * 60)
    sftp = c.open_sftp()
    base = '/Users/fangjin/Desktop/p/docker-openclawd'
    for d, name in [('deploy', 'Alin'), ('deploy-aling', 'Aling'), ('deploy-lain', 'Lain'), ('deploy-lumi', 'Lumi')]:
        with sftp.open(f'{base}/{d}/api-proxy.js', 'r') as f:
            content = f.read().decode()
        # Extract key routing info
        for line in content.split('\n'):
            if 'GATEWAY_HOST' in line or 'GATEWAY_PORT' in line or 'CLIENT_API_KEY' in line:
                print(f"  {name}: {line.strip()}")

    print()
    print("=" * 60)
    print("STEP 5: LLM Gateway config (provider routing)")
    print("=" * 60)
    with sftp.open('/Users/fangjin/llm-gateway-v2/config.json', 'r') as f:
        gw_cfg = json.loads(f.read().decode())

    print("  Providers:")
    for name, p in gw_cfg.get('providers', {}).items():
        print(f"    {name}: baseUrl={p.get('baseUrl')}, api={p.get('api')}, modelMap={p.get('modelMap', {})}")

    print("  Bot routing:")
    for bot_id, bot_cfg in gw_cfg.get('bots', {}).items():
        print(f"    {bot_cfg.get('name')}: provider={bot_cfg.get('provider')}")

    print("  Model options:")
    for opt in gw_cfg.get('modelOptions', []):
        print(f"    {opt.get('id')} -> {opt.get('label')}")

    print()
    print("=" * 60)
    print("STEP 6: LLM Gateway recent activity")
    print("=" * 60)
    _, o, e = c.exec_command('tail -20 /private/tmp/gateway-v2.log')
    for line in o.read().decode('utf-8', errors='replace').strip().split('\n'):
        if '[Proxy]' in line or 'tokens:' in line:
            print(f"  {line.strip()}")

    sftp.close()
    c.close()

if __name__ == '__main__':
    main()
