import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', username='root', password='YYZZ54321!')

API_KEY = 'sk-antigravity-openclaw'

# 1. Check if gemini-3-pro-thinking exists in model list
print("=== Available Gemini models ===")
stdin, stdout, stderr = vps.exec_command(
    f'curl -s http://127.0.0.1:8045/v1/models -H "Authorization: Bearer {API_KEY}" --max-time 10'
)
models = json.loads(stdout.read().decode())
gemini_models = [m['id'] for m in models.get('data', []) if 'gemini' in m['id']]
for m in sorted(gemini_models):
    marker = " <---" if 'thinking' in m or 'pro' in m else ""
    print(f"  {m}{marker}")

has_thinking = 'gemini-3-pro-thinking' in gemini_models
print(f"\ngemini-3-pro-thinking available: {has_thinking}")

# 2. Test gemini-3-pro (non-thinking) with thinking parameter via Anthropic format
print("\n=== Test: gemini-3-pro via Anthropic proxy (8047) with thinking ===")
test_body = json.dumps({
    "model": "gemini-3-pro",
    "messages": [{"role": "user", "content": "What is 15 * 23? Think step by step."}],
    "max_tokens": 500,
    "thinking": {"type": "enabled", "budget_tokens": 5000}
})
stdin, stdout, stderr = vps.exec_command(
    f"curl -s http://127.0.0.1:8047/v1/messages "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
result = stdout.read().decode()
print(f"Response: {result[:1500]}")

# 3. Test gemini-2.5-flash-thinking (known thinking model)
print("\n=== Test: gemini-2.5-flash-thinking ===")
test_body2 = json.dumps({
    "model": "gemini-2.5-flash-thinking",
    "messages": [{"role": "user", "content": "What is 15 * 23? Think step by step."}],
    "max_tokens": 500,
    "thinking": {"type": "enabled", "budget_tokens": 5000}
})
stdin, stdout, stderr = vps.exec_command(
    f"curl -s http://127.0.0.1:8047/v1/messages "
    f"-H 'x-api-key: {API_KEY}' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body2}' --max-time 60"
)
result2 = stdout.read().decode()
print(f"Response: {result2[:1500]}")

# 4. Direct OpenAI format test for gemini-3-pro with reasoning
print("\n=== Test: gemini-3-pro via OpenAI format (8045) ===")
test_body3 = json.dumps({
    "model": "gemini-3-pro",
    "messages": [{"role": "user", "content": "What is 15*23?"}],
    "max_tokens": 200
})
stdin, stdout, stderr = vps.exec_command(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body3}' --max-time 30"
)
result3 = stdout.read().decode()
print(f"Response: {result3[:1500]}")

vps.close()
print("\n[DONE]")
