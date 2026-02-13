import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Gateway logs
print("=== Gateway logs ===")
print(run('tail -20 /tmp/gateway.log'))

# Bridge logs
print("\n=== Bridge logs ===")
print(run('tail -10 /tmp/cc-bridge.log'))

# Full raw response test (no filtering)
print("\n=== Full raw test (new session) ===")
test_body = json.dumps({
    "session_id": "test-raw",
    "message": "Say hello world",
    "working_directory": "/Users/fangjin/llm-gateway"
})
result = run(
    f'{PATH_PREFIX} && curl -sN http://127.0.0.1:9090/api/chat '
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' "
    f"--max-time 60 2>&1",
    timeout=90
)
print("Full output:")
print(result[:5000])

# Gateway logs after
print("\n=== Gateway logs after test ===")
print(run('tail -20 /tmp/gateway.log'))

mac.close()
