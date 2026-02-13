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

# Step 1: Check router.js for default model and routing logic
print("=== Router.js model routing (key lines) ===")
out, _ = run("grep -n 'defaultModel\\|model_override\\|actualModel\\|claude-sonnet\\|claude-opus\\|gemini' /Users/fangjin/llm-gateway/router.js | head -30")
print(out)

# Check server.js for model config
print("\n=== Server.js model config ===")
out, _ = run("grep -n 'defaultModel\\|model.*override\\|sonnet\\|opus\\|gemini' /Users/fangjin/llm-gateway/server.js | head -20")
print(out)

# Step 2: Enable Codesome provider
print("\n=== Enable Codesome (provider 2) ===")
out, _ = run(
    "curl -s -X PUT http://localhost:8080/api/providers/2 "
    "-H 'Content-Type: application/json' "
    "-d '{\"enabled\": true}'"
)
print(out[:300])

# Step 3: Verify providers now
print("\n=== Verify providers ===")
out, _ = run("curl -s http://localhost:8080/api/providers")
try:
    providers = json.loads(out)
    for p in providers:
        print(f"  [{p.get('id')}] {p.get('name')} enabled:{p.get('enabled')} priority:{p.get('priority')}")
except:
    print(out[:500])

# Step 4: Set model override for all clients to claude-sonnet-4-5-thinking
print("\n=== Set model_override for all clients ===")
for client_id in [3, 4, 5, 6]:
    out, _ = run(
        f"curl -s -X PUT http://localhost:8080/api/clients/{client_id} "
        f"-H 'Content-Type: application/json' "
        f"-d '{{\"model_override\": \"claude-sonnet-4-5-thinking\"}}'"
    )
    try:
        c = json.loads(out)
        print(f"  [{c.get('id')}] {c.get('name')} -> model_override: {c.get('model_override')}")
    except:
        print(f"  Client {client_id}: {out[:200]}")

# Step 5: Verify final state
print("\n=== Final clients state ===")
out, _ = run("curl -s http://localhost:8080/api/clients")
try:
    clients = json.loads(out)
    for c in clients:
        print(f"  [{c.get('id')}] {c.get('name')} model_override:{c.get('model_override')} enabled:{c.get('enabled')}")
except:
    print(out[:500])

# Step 6: Quick test - route through gateway
print("\n=== Test: Gateway → Codesome ===")
# Use one of the bot's API keys
body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly: Gateway Codesome OK"}],
    "max_tokens": 30
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
    content = r.get('content', [{}])
    text_parts = [b.get('text', '') for b in content if b.get('type') == 'text']
    think_parts = [b.get('thinking', '')[:100] for b in content if b.get('type') == 'thinking']
    print(f"  Model: {r.get('model', 'unknown')}")
    print(f"  Text: {' '.join(text_parts)}")
    if think_parts:
        print(f"  Thinking: {think_parts[0][:100]}")
    if r.get('error'):
        print(f"  Error: {r['error']}")
except:
    print(f"  Raw: {out[:500]}")

mac.close()
print("\n[DONE]")
