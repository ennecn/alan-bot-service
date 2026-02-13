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

# 1: Get current Codesome provider config (from list endpoint)
print("=== Current Codesome config ===")
out, _ = run("curl -s http://localhost:8080/api/providers")
codesome = None
try:
    providers = json.loads(out)
    for p in providers:
        if p['id'] == 2:
            codesome = p
            print(f"  supported_models: {p.get('supported_models')}")
            print(f"  model_mapping: {p.get('model_mapping')}")
            break
except:
    print(out[:500])

# 2: Update Codesome - add model mapping and supported models
print("\n=== Update Codesome model_mapping ===")
model_mapping = json.dumps({
    "claude-opus-4-6-thinking": "claude-sonnet-4-5-thinking",
    "claude-opus-4-6": "claude-sonnet-4-5-thinking"
})
# Also update supported_models to include sonnet
supported_models = json.dumps([
    "claude-opus-4-6", "claude-opus-4-6-thinking",
    "claude-opus-4-5", "claude-opus-4-5-thinking",
    "claude-sonnet-4-5-thinking", "claude-sonnet-4-5-20250929-thinking"
])

update_body = json.dumps({
    "model_mapping": model_mapping,
    "supported_models": supported_models
})

out, _ = run(
    f"curl -s -X PUT http://localhost:8080/api/providers/2 "
    f"-H 'Content-Type: application/json' "
    f"-d '{update_body}'"
)
try:
    r = json.loads(out)
    print(f"  name: {r.get('name')}")
    print(f"  model_mapping: {r.get('model_mapping')}")
    print(f"  supported_models: {r.get('supported_models')}")
except:
    print(f"  Raw: {out[:500]}")

# 3: Verify - test with the model name bots would use
print("\n=== Test: Gateway with claude-opus-4-6-thinking → should map to sonnet ===")
body = json.dumps({
    "model": "claude-opus-4-6-thinking",
    "messages": [{"role": "user", "content": "What model are you? Say your exact model name."}],
    "max_tokens": 50,
    "stream": False
})
out, _ = run(
    f"curl -s http://localhost:8080/v1/messages "
    f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 30"
)
try:
    r = json.loads(out)
    text_parts = [b.get('text', '') for b in r.get('content', []) if b.get('type') == 'text']
    print(f"  Returned model: {r.get('model', 'unknown')}")
    print(f"  Text: {' '.join(text_parts)}")
except:
    # SSE response - extract key info
    lines = out.split('\n')
    for line in lines:
        if '"model"' in line:
            print(f"  {line.strip()[:200]}")
        if '"text"' in line and 'content_block' not in line:
            print(f"  {line.strip()[:200]}")

# 4: Final status
print("\n=== Final provider status ===")
out, _ = run("curl -s http://localhost:8080/api/providers")
try:
    for p in json.loads(out):
        status = "ENABLED" if p['enabled'] else "disabled"
        print(f"  [{p['id']}] {p['name']} [{status}] priority:{p['priority']} mapping:{p.get('model_mapping', '{}')[:100]}")
except:
    print(out[:500])

mac.close()
print("\n[DONE]")
