import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

API_KEY = 'sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW'
BASE_URL = 'https://ai.t8star.cn'

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Test with claude-opus-4-6-thinking (non-stream)
print("=== Test A: claude-opus-4-6-thinking (non-stream, x-api-key) ===")
body = json.dumps({
    "model": "claude-opus-4-6-thinking",
    "messages": [{"role": "user", "content": "Say exactly: T8 OK"}],
    "max_tokens": 100
})
out, err = run(
    f"curl -s '{BASE_URL}/v1/messages' "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 45"
)
print(out[:2000])
if err: print(f"STDERR: {err[:500]}")

# Test with claude-sonnet-4-5-20250929-thinking (stream)
print("\n=== Test B: claude-sonnet-4-5-20250929-thinking (stream, x-api-key) ===")
body_stream = json.dumps({
    "model": "claude-sonnet-4-5-20250929-thinking",
    "messages": [{"role": "user", "content": "Say exactly: streaming T8 OK"}],
    "max_tokens": 100,
    "stream": True
})
out, err = run(
    f"curl -sN '{BASE_URL}/v1/messages' "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body_stream}' --max-time 45"
)
print(out[:3000])
if err: print(f"STDERR: {err[:500]}")

# Test with Bearer auth (important for Claude Code compatibility)
print("\n=== Test C: claude-opus-4-6-thinking (non-stream, Bearer auth) ===")
body2 = json.dumps({
    "model": "claude-opus-4-6-thinking",
    "messages": [{"role": "user", "content": "Say exactly: Bearer OK"}],
    "max_tokens": 100
})
out, err = run(
    f"curl -s '{BASE_URL}/v1/messages' "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body2}' --max-time 45"
)
print(out[:2000])
if err: print(f"STDERR: {err[:500]}")

# Test with thinking parameters (Claude Code often sends these)
print("\n=== Test D: With thinking params (budget_tokens) ===")
body_think = json.dumps({
    "model": "claude-opus-4-6-thinking",
    "messages": [{"role": "user", "content": "Say exactly: thinking OK"}],
    "max_tokens": 16000,
    "thinking": {
        "type": "enabled",
        "budget_tokens": 10000
    }
})
out, err = run(
    f"curl -s '{BASE_URL}/v1/messages' "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body_think}' --max-time 45"
)
print(out[:3000])
if err: print(f"STDERR: {err[:500]}")

mac.close()
print("\n[DONE]")
