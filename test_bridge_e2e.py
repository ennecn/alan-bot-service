import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Test 1: Direct from Mac Mini host (bypass Docker)
print("=== Test 1: Direct bridge call from host ===")
body = json.dumps({
    "session_id": "t8-test",
    "message": "Say exactly: T8 bridge OK. Nothing else.",
    "model": "claude-opus-4-6-thinking"
})
out, err = run(
    f"curl -sN http://localhost:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 90",
    timeout=100
)
print(f"Response ({len(out)} chars):")
# Parse SSE events
for line in out.split('\n'):
    line = line.strip()
    if line.startswith('data: '):
        try:
            data = json.loads(line[6:])
            if data.get('type') == 'result':
                print(f"  RESULT: {json.dumps(data.get('result', ''), ensure_ascii=False)[:500]}")
            elif data.get('type') == 'assistant':
                msg = data.get('message', {})
                for block in msg.get('content', []):
                    if block.get('type') == 'text':
                        print(f"  TEXT: {block['text'][:300]}")
                    elif block.get('type') == 'thinking':
                        print(f"  THINKING: {block.get('thinking', '')[:200]}")
            elif 'exit_code' in data:
                print(f"  DONE: exit_code={data['exit_code']}")
            elif 'session_id' in data and 'uuid' in data:
                print(f"  SESSION: {data['session_id']} -> {data['uuid'][:8]}...")
            elif 'text' in data and data.get('type') != 'result':
                # error or log
                print(f"  LOG/ERR: {data['text'][:300]}")
        except:
            print(f"  RAW: {line[:200]}")
    elif line.startswith('event: '):
        pass  # skip event type lines
    elif line:
        print(f"  OTHER: {line[:200]}")

if err:
    print(f"\nSTDERR: {err[:500]}")

# Check bridge log
print("\n=== Bridge log (last 15 lines) ===")
out, _ = run("tail -15 /Users/fangjin/cc-bridge/bridge.log")
print(out)

mac.close()
print("\n[DONE]")
