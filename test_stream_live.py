import paramiko, json, sys, io, time, select
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Add debug logging to the stream converter
print("=== Adding debug logging to stream converter ===")
sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')

# Add console.log to see raw data from Antigravity
old_line = "      try {\n        const parsed = JSON.parse(data);\n        const choice = parsed.choices?.[0];"
new_line = "      try {\n        const parsed = JSON.parse(data);\n        console.log(`[StreamDebug] Chunk: ${data.substring(0, 200)}`);\n        const choice = parsed.choices?.[0];"

if old_line in content:
    patched = content.replace(old_line, new_line, 1)
    with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
        f.write(patched.encode('utf-8'))
    print("  [OK] Debug logging added")
else:
    # Try without exact newline match
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'const parsed = JSON.parse(data);' in line and i > 700:
            print(f"  Found at L{i+1}: {line.rstrip()}")
            # Insert debug log after this line
            lines.insert(i+1, "        console.log(`[StreamDebug] Chunk: ${data.substring(0, 200)}`);")
            patched = '\n'.join(lines)
            with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
                f.write(patched.encode('utf-8'))
            print("  [OK] Debug log inserted")
            break

sftp.close()

# Restart Gateway
PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
if pid:
    run(f'kill {pid}')
    time.sleep(2)
run(f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
time.sleep(3)
print(f"  Gateway PID: {run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')}")

# Send a test request
print("\n=== Sending test request ===")
test_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say hello world"}],
    "max_tokens": 100,
    "stream": True
})
result = run(
    f"curl -sN http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 20",
    timeout=30
)
print("SSE output:")
print(result[:2000])

# Check debug logs
print("\n=== Gateway debug logs ===")
print(run('tail -20 /tmp/gateway.log'))

mac.close()
print("\n[DONE]")
