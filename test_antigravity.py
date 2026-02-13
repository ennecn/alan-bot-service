import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', username='root', password='YYZZ54321!')

API_KEY = 'sk-antigravity-openclaw'

# Test 1: List models with correct API key
print("=== Test 1: List models (OpenAI format, port 8045) ===")
stdin, stdout, stderr = vps.exec_command(
    f'curl -s http://127.0.0.1:8045/v1/models -H "Authorization: Bearer {API_KEY}" --max-time 10'
)
models = stdout.read().decode()
print(models[:2000] if models else "(empty)")

# Test 2: Small chat completion (OpenAI format, port 8045)
print("\n=== Test 2: Chat completion - gemini-3-flash (OpenAI, port 8045) ===")
test_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Say hi in exactly 3 words"}],
    "max_tokens": 30
})
stdin, stdout, stderr = vps.exec_command(
    f"curl -s -w '\\nHTTP_CODE:%{{http_code}}' http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
result = stdout.read().decode()
print(result[:1500])

# Test 3: Via anthropic-proxy (port 8047) if it exists
print("\n=== Test 3: Via anthropic-proxy (port 8047, Anthropic format) ===")
stdin, stdout, stderr = vps.exec_command('lsof -i :8047 | head -3')
proxy_status = stdout.read().decode()
print(f"Port 8047 status: {proxy_status if proxy_status else 'NOT RUNNING'}")

if proxy_status:
    anthro_body = json.dumps({
        "model": "gemini-3-flash",
        "messages": [{"role": "user", "content": "Say hi in exactly 3 words"}],
        "max_tokens": 30
    })
    stdin, stdout, stderr = vps.exec_command(
        f"curl -s -w '\\nHTTP_CODE:%{{http_code}}' http://127.0.0.1:8047/v1/messages "
        f"-H 'x-api-key: {API_KEY}' "
        f"-H 'anthropic-version: 2023-06-01' "
        f"-H 'Content-Type: application/json' "
        f"-d '{anthro_body}' --max-time 30"
    )
    result = stdout.read().decode()
    print(result[:1500])

# Test 4: Check from Mac Mini side through the Gateway
print("\n=== Test 4: Test via LLM Gateway on Mac Mini ===")
vps.close()

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Direct test to Antigravity from Mac Mini
print("Direct to Antigravity from Mac Mini:")
stdin, stdout, stderr = mac.exec_command(
    f"curl -s -w '\\nHTTP_CODE:%{{http_code}}' http://138.68.44.141:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
result = stdout.read().decode()
print(result[:1500])

mac.close()
print("\n[DONE]")
