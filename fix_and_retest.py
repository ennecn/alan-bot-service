import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Kill stuck session and restart Bridge
print("=== Restarting Bridge (pointing to LLM Gateway) ===")
out = run(f'{PATH_PREFIX} && lsof -i :9090 -t 2>/dev/null')
if out:
    run(f'kill -9 {out}')
    time.sleep(1)

# Kill any lingering claude processes
run(f'{PATH_PREFIX} && pkill -f "claude.*print" 2>/dev/null')
time.sleep(1)

# Restart with LLM Gateway as backend (temporarily, for testing)
# Claude Code will send requests to Gateway which routes to Antigravity (Gemini 3 Flash)
run(
    f'{PATH_PREFIX} && cd /Users/fangjin/cc-bridge && '
    f'ANTHROPIC_API_KEY="gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    f'ANTHROPIC_BASE_URL="http://127.0.0.1:8080" '
    f'nohup /opt/homebrew/bin/node cc-bridge.js > /tmp/cc-bridge.log 2>&1 & echo $!'
)
time.sleep(3)

out = run('curl -s http://127.0.0.1:9090/health')
print(f"  Health: {out}")

# Test
print("\n=== Test: Simple task ===")
test_body = json.dumps({
    "session_id": "test-gateway-backend",
    "message": "List files in the current directory and tell me what this project is. Be brief.",
    "working_directory": "/Users/fangjin/llm-gateway"
})

out = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' "
    f"--max-time 120 2>&1",
    timeout=150
)

# Parse and display results
print("Response:")
for line in out.split('\n'):
    if not line.strip():
        continue
    if line.startswith('event:'):
        print(f"\n  {line}")
    elif line.startswith('data:'):
        try:
            data = json.loads(line[5:].strip())
            evt_type = data.get('type', '')
            
            if evt_type == 'assistant':
                # Show text content
                for block in data.get('message', {}).get('content', []):
                    if block.get('type') == 'text' and block.get('text'):
                        print(f"    [CLAUDE] {block['text'][:300]}")
                    elif block.get('type') == 'tool_use':
                        print(f"    [TOOL] {block.get('name')}: {str(block.get('input', ''))[:200]}")
            elif evt_type == 'result':
                cost = data.get('total_cost_usd', 0)
                turns = data.get('num_turns', 0)
                errors = data.get('errors', [])
                result_text = data.get('result', '')[:300]
                print(f"    [RESULT] turns={turns}, cost=${cost}")
                if result_text:
                    print(f"    {result_text}")
                if errors:
                    print(f"    ERRORS: {errors}")
            elif evt_type == 'system':
                subtype = data.get('subtype', '')
                print(f"    [SYSTEM] {subtype}")
            elif 'text' in data:
                print(f"    [LOG] {data['text'][:200]}")
            else:
                # Show abbreviated
                abbreviated = str(data)[:200]
                print(f"    {abbreviated}")
        except:
            if len(line) > 200:
                print(f"  {line[:200]}...")
            else:
                print(f"  {line}")

# Session check
print("\n\n=== Session ===")
out = run('curl -s http://127.0.0.1:9090/api/sessions/test-gateway-backend')
try:
    sess = json.loads(out)
    print(f"  Name: {sess.get('name')}")
    print(f"  Messages: {sess.get('messageCount')}")
    print(f"  Active: {sess.get('active')}")
    for h in sess.get('history', []):
        print(f"  [{h.get('timestamp')}] exit={h.get('exitCode')}: {h.get('responsePreview', '')[:200]}")
except:
    print(out[:500])

# Bridge logs
print("\n=== Bridge logs ===")
print(run('tail -15 /tmp/cc-bridge.log'))

mac.close()
print("\n[DONE]")
