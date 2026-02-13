import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# First: capture raw SSE from Gateway to see what it sends
print("=== Raw SSE from Gateway ===")
test_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly: hello from gateway"}],
    "max_tokens": 50,
    "stream": True
})
raw = run(
    f"curl -sN http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30 2>&1",
    timeout=45
)
print(raw[:3000])

# Now check the stream conversion function in router.js
print("\n\n=== Stream conversion function ===")
content = run('cat /Users/fangjin/llm-gateway/router.js')
# Find createOpenAIToAnthropicStream
start = content.find('function createOpenAIToAnthropicStream')
if start >= 0:
    end = content.find('\n}\n', start + 100) + 3
    func = content[start:end]
    print(func[:3000])

mac.close()
