import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Remove debug logging
print("=== Clean up debug logging ===")
sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')
content = content.replace("        console.log(`[StreamDebug] Chunk: ${data.substring(0, 200)}`);\n", "")
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
    f.write(content.encode('utf-8'))
sftp.close()
print("  [OK] Debug log removed")

# Restart Gateway
pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
if pid:
    run(f'kill {pid}')
    time.sleep(2)
run(f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
time.sleep(3)

# Restart Bridge
bp = run(f'{PATH_PREFIX} && lsof -i :9090 -t 2>/dev/null')
if bp:
    run(f'kill -9 {bp}')
    time.sleep(1)
run(f'{PATH_PREFIX} && pkill -f "claude.*print" 2>/dev/null')
time.sleep(1)
run(
    f'{PATH_PREFIX} && cd /Users/fangjin/cc-bridge && '
    f'ANTHROPIC_API_KEY="gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    f'ANTHROPIC_BASE_URL="http://127.0.0.1:8080" '
    f'nohup /opt/homebrew/bin/node cc-bridge.js > /tmp/cc-bridge.log 2>&1 & echo $!'
)
time.sleep(3)
print(f"Gateway: {run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')}")
print(f"Bridge: {run('curl -s http://127.0.0.1:9090/health')}")

# ============================================================
# Full E2E Test from Alin container
# ============================================================
print("\n" + "=" * 60)
print("E2E Test: Alin -> Bridge -> Claude Code -> Gateway -> Antigravity")
print("=" * 60)

test_body = json.dumps({
    "session_id": "e2e-test",
    "message": "List the files in the current directory and briefly describe what each file does.",
    "working_directory": "/Users/fangjin/llm-gateway"
})

print("\nSending task...")
result = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' "
    f"--max-time 120 2>&1",
    timeout=150
)

print("\n--- Response ---")
for line in result.split('\n'):
    if not line.startswith('data:'):
        continue
    try:
        d = json.loads(line[5:].strip())
        t = d.get('type', '')
        if t == 'assistant':
            for block in d.get('message', {}).get('content', []):
                if block.get('type') == 'text' and block.get('text'):
                    print(f"[CLAUDE TEXT] {block['text']}")
                elif block.get('type') == 'tool_use':
                    print(f"[TOOL USE] {block.get('name')}: {str(block.get('input', ''))[:200]}")
        elif t == 'tool':
            msg = d.get('message', {})
            if isinstance(msg.get('content'), list):
                for b in msg['content']:
                    if b.get('content'):
                        txt = b['content'] if isinstance(b['content'], str) else str(b['content'])
                        print(f"[TOOL RESULT] {txt[:500]}")
            elif isinstance(msg.get('content'), str):
                print(f"[TOOL RESULT] {msg['content'][:500]}")
        elif t == 'result':
            print(f"\n[RESULT] turns={d.get('num_turns')}, cost=${d.get('total_cost_usd')}, duration={d.get('duration_ms')}ms")
            if d.get('result'):
                print(f"  {d['result'][:1000]}")
            if d.get('errors'):
                for e in d['errors']:
                    print(f"  [ERROR] {str(e)[:300]}")
    except:
        pass

# Follow-up test (context persistence)
print("\n" + "=" * 60)
print("Follow-up Test: Same session (context persistence)")
print("=" * 60)

followup = json.dumps({
    "session_id": "e2e-test",
    "message": "Based on what you already know about this project, what port does the server listen on?"
})

result2 = run(
    f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
    f"curl -sN http://host.docker.internal:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{followup}' "
    f"--max-time 60 2>&1",
    timeout=90
)

print("\n--- Follow-up Response ---")
for line in result2.split('\n'):
    if not line.startswith('data:'):
        continue
    try:
        d = json.loads(line[5:].strip())
        t = d.get('type', '')
        if t == 'assistant':
            for block in d.get('message', {}).get('content', []):
                if block.get('type') == 'text' and block.get('text'):
                    print(f"[CLAUDE TEXT] {block['text']}")
        elif t == 'result':
            print(f"\n[RESULT] turns={d.get('num_turns')}, cost=${d.get('total_cost_usd')}")
            if d.get('result'):
                print(f"  {d['result'][:500]}")
    except:
        pass

# Session info
print("\n=== Session Info ===")
print(run('curl -s http://127.0.0.1:9090/api/sessions/e2e-test | python3 -m json.tool 2>/dev/null'))

mac.close()
print("\n[DONE]")
