import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

API_KEY = 'sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW'
BASE_URL = 'https://ai.t8star.cn'

# Test 1: Empty body (see error format)
print("=== Test 1: Empty body ===")
print(run(
    f"curl -s '{BASE_URL}/v1/messages' "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{{}}' --max-time 10"
))

# Test 2: Anthropic format (x-api-key header)
print("\n=== Test 2: Anthropic format ===")
body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly: T8 test OK"}],
    "max_tokens": 50
})
print(run(
    f"curl -s '{BASE_URL}/v1/messages' "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 30"
))

# Test 3: With Authorization Bearer header
print("\n=== Test 3: Bearer auth ===")
print(run(
    f"curl -s '{BASE_URL}/v1/messages' "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 30"
))

# Test 4: List models
print("\n=== Test 4: List models ===")
print(run(
    f"curl -s '{BASE_URL}/v1/models' "
    f"-H 'Authorization: Bearer {API_KEY}' --max-time 10"
)[:2000])

# Test 5: Streaming
print("\n=== Test 5: Streaming ===")
body_stream = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly: streaming OK"}],
    "max_tokens": 50,
    "stream": True
})
print(run(
    f"curl -sN '{BASE_URL}/v1/messages' "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body_stream}' --max-time 30"
)[:3000])

# Test 6: count_tokens endpoint
print("\n=== Test 6: count_tokens ===")
count_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Hello"}]
})
print(run(
    f"curl -s -w '\\nHTTP:%{{http_code}}' '{BASE_URL}/v1/messages/count_tokens' "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{count_body}' --max-time 10"
))

mac.close()
print("\n[DONE]")
