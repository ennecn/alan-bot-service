import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    full_cmd = f'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" && {cmd}'
    stdin, stdout, stderr = mac.exec_command(full_cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# 1. Check current Gateway config - providers and model mappings
print("=== Gateway providers ===")
out, _ = run("curl -s http://localhost:8080/api/providers")
try:
    providers = json.loads(out)
    for p in providers:
        print(f"  [{p.get('id')}] {p.get('name')} - {p.get('base_url')} (format: {p.get('api_format')}, enabled: {p.get('enabled')}, priority: {p.get('priority')})")
except:
    print(out[:1000])

# 2. Check current model mappings
print("\n=== Gateway model mappings ===")
out, _ = run("curl -s http://localhost:8080/api/models")
try:
    models = json.loads(out)
    for m in models:
        print(f"  {m.get('name')} -> provider:{m.get('provider_id')} actual:{m.get('actual_model')} (enabled: {m.get('enabled')})")
except:
    print(out[:1000])

# 3. Check Codesome available models (we know sonnet 4.5 thinking exists)
print("\n=== Codesome model test: claude-sonnet-4-5-20250929-thinking ===")
body = json.dumps({
    "model": "claude-sonnet-4-5-20250929-thinking",
    "messages": [{"role": "user", "content": "Say: model check OK"}],
    "max_tokens": 20
})
out, _ = run(
    f"curl -s 'https://v3.codesome.cn/v1/messages' "
    f"-H 'x-api-key: sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 30"
)
try:
    r = json.loads(out)
    model_used = r.get('model', '')
    content = r.get('content', [{}])[0].get('text', '') if r.get('content') else ''
    print(f"  Model returned: {model_used}")
    print(f"  Response: {content}")
except:
    print(f"  Raw: {out[:500]}")

# 4. Also test without date suffix
print("\n=== Codesome: claude-sonnet-4-5-thinking (no date) ===")
body2 = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say: alias check OK"}],
    "max_tokens": 20
})
out, _ = run(
    f"curl -s 'https://v3.codesome.cn/v1/messages' "
    f"-H 'x-api-key: sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body2}' --max-time 30"
)
try:
    r = json.loads(out)
    model_used = r.get('model', '')
    content = r.get('content', [{}])[0].get('text', '') if r.get('content') else ''
    err_msg = r.get('error', {}).get('message', '')
    print(f"  Model returned: {model_used}")
    print(f"  Response: {content}")
    if err_msg:
        print(f"  Error: {err_msg}")
except:
    print(f"  Raw: {out[:500]}")

# 5. Check current clients
print("\n=== Gateway clients ===")
out, _ = run("curl -s http://localhost:8080/api/clients")
try:
    clients = json.loads(out)
    for c in clients:
        print(f"  [{c.get('id')}] {c.get('name')} model_override:{c.get('model_override')} (enabled: {c.get('enabled')})")
except:
    print(out[:500])

mac.close()
print("\n[DONE]")
