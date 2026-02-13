import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# ============================================================
# Test 1: Simple task from inside Alin container
# ============================================================
print("=== Test 1: Simple task from Alin container ===")

test_body = json.dumps({
    "session_id": "test-bridge-001",
    "message": "List the files in the current directory and tell me what project this is.",
    "working_directory": "/Users/fangjin/llm-gateway"
})

result = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' "
    f"--max-time 60 2>&1 | head -80",
    timeout=90
)
print(result[:3000])

# ============================================================
# Test 2: Check session was created
# ============================================================
print("\n\n=== Test 2: Check sessions ===")
result = run('curl -s http://127.0.0.1:9090/api/sessions')
print(result[:1000])

# ============================================================
# Test 3: Follow-up in same session (context test)
# ============================================================
print("\n\n=== Test 3: Follow-up (same session = context) ===")
followup_body = json.dumps({
    "session_id": "test-bridge-001",
    "message": "Based on what you just saw, what is the main entry point file and what port does the server listen on?"
})
result = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{followup_body}' "
    f"--max-time 60 2>&1 | head -80",
    timeout=90
)
print(result[:3000])

# ============================================================
# Test 4: Verify session history
# ============================================================
print("\n\n=== Test 4: Session history ===")
result = run('curl -s http://127.0.0.1:9090/api/sessions/test-bridge-001')
print(result[:2000])

# ============================================================
# Check bridge logs
# ============================================================
print("\n\n=== Bridge logs ===")
result = run('tail -15 /tmp/cc-bridge.log')
print(result)

mac.close()
print("\n[DONE]")
