import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Test Codesome API
print("=== Test Codesome API ===")
body = json.dumps({
    "model": "claude-sonnet-4-5-20250929",
    "messages": [{"role": "user", "content": "Say exactly: Codesome OK"}],
    "max_tokens": 30
})
out, err = run(
    f"curl -s 'https://v3.codesome.cn/v1/messages' "
    f"-H 'x-api-key: sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 30",
    timeout=35
)
print(out[:1000])

# Also check cc-bridge health
print("\n=== Bridge health ===")
out, _ = run("curl -s http://localhost:9090/health --max-time 5")
print(out)

mac.close()
print("\n[DONE]")
