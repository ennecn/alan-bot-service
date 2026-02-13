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

# 1: Enable Codesome with integer
print("=== Enable Codesome (integer) ===")
out, _ = run(
    'curl -s -X PUT http://localhost:8080/api/providers/2 '
    '-H "Content-Type: application/json" '
    '-d \'{"enabled": 1}\''
)
print(out[:300])

# 2: Check the API format for model_override
print("\n=== Check client API fields ===")
out, _ = run("curl -s http://localhost:8080/api/clients/4")
print(out[:500])

# 3: Set model override using string
print("\n=== Set model_override ===")
for client_id in [3, 4, 5, 6]:
    out, _ = run(
        f'curl -s -X PUT http://localhost:8080/api/clients/{client_id} '
        f'-H "Content-Type: application/json" '
        f'-d \'{{"model_override": "claude-sonnet-4-5-thinking"}}\''
    )
    print(f"  Client {client_id}: {out[:200]}")

# 4: Verify
print("\n=== Verify providers ===")
out, _ = run("curl -s http://localhost:8080/api/providers")
try:
    for p in json.loads(out):
        print(f"  [{p['id']}] {p['name']} enabled:{p['enabled']} priority:{p['priority']}")
except:
    print(out[:500])

print("\n=== Verify clients ===")
out, _ = run("curl -s http://localhost:8080/api/clients")
try:
    for c in json.loads(out):
        print(f"  [{c['id']}] {c['name']} model_override:{c.get('model_override')}")
except:
    print(out[:500])

# 5: Test with non-streaming
print("\n=== Test: Gateway → Codesome (non-stream) ===")
body = '{"model":"claude-sonnet-4-5-thinking","messages":[{"role":"user","content":"Say exactly: Codesome route OK"}],"max_tokens":30,"stream":false}'
out, _ = run(
    f'curl -s http://localhost:8080/v1/messages '
    f'-H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    f'-H "anthropic-version: 2023-06-01" '
    f'-H "Content-Type: application/json" '
    f'-d \'{body}\' --max-time 30'
)
try:
    r = json.loads(out)
    text_parts = [b.get('text', '') for b in r.get('content', []) if b.get('type') == 'text']
    print(f"  Model: {r.get('model', 'unknown')}")
    print(f"  Text: {' '.join(text_parts)}")
    if r.get('error'):
        print(f"  Error: {r['error']}")
except:
    # Might be SSE
    for line in out.split('\n')[:5]:
        print(f"  {line[:200]}")

# 6: Check gateway logs to confirm routing
print("\n=== Gateway log (last 10 lines) ===")
out, _ = run("tail -10 /Users/fangjin/llm-gateway/gateway.log 2>/dev/null || echo 'no log file'")
print(out[:500])

mac.close()
print("\n[DONE]")
