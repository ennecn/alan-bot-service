import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Test direct OpenAI stream to Antigravity
print("=== Raw OpenAI stream from Antigravity ===")
test_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Say exactly: hello world"}],
    "max_tokens": 50,
    "stream": True
})
result = run(
    f"curl -sN http://138.68.44.141:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer sk-antigravity-openclaw' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 20",
    timeout=30
)
print(result[:3000])

# Also test non-streaming
print("\n\n=== Non-streaming from Antigravity ===")
test_body2 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Say exactly: hello world"}],
    "max_tokens": 50,
    "stream": False
})
result2 = run(
    f"curl -s http://138.68.44.141:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer sk-antigravity-openclaw' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body2}' --max-time 20",
    timeout=30
)
print(result2[:1000])

mac.close()
