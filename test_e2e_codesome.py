import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    full_cmd = f'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" && {cmd}'
    stdin, stdout, stderr = mac.exec_command(full_cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Test 1: Direct bridge call (Codesome backend)
print("=== Test 1: Bridge → Claude Code → Codesome ===")
body = json.dumps({
    "session_id": "codesome-e2e-test",
    "message": "Say exactly: Codesome bridge test successful. Nothing else."
})
out, err = run(
    f"curl -sN http://localhost:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{body}' --max-time 90",
    timeout=100
)

print(f"Response ({len(out)} chars):")
for line in out.split('\n'):
    line = line.strip()
    if line.startswith('data: '):
        try:
            data = json.loads(line[6:])
            dtype = data.get('type', '')
            if dtype == 'result':
                print(f"  [RESULT] {json.dumps(data.get('result', ''), ensure_ascii=False)[:500]}")
            elif dtype == 'assistant':
                msg = data.get('message', {})
                for block in msg.get('content', []):
                    if block.get('type') == 'text':
                        print(f"  [TEXT] {block['text'][:300]}")
                    elif block.get('type') == 'thinking':
                        print(f"  [THINKING] {block.get('thinking', '')[:200]}")
            elif 'exit_code' in data:
                print(f"  [DONE] exit_code={data['exit_code']}")
            elif 'session_id' in data and 'uuid' in data:
                print(f"  [SESSION] {data['session_id']}")
            elif 'text' in data:
                print(f"  [LOG] {data['text'][:300]}")
        except:
            print(f"  [RAW] {line[:200]}")

# Test 2: From inside Alin container (simulating bot usage)
print("\n=== Test 2: From Alin container → Bridge → Claude Code ===")
inner_body = json.dumps({
    "session_id": "alin-skill-test",
    "message": "What is the current date and time? Use the bash tool to run 'date'."
}).replace('"', '\\"')

out, err = run(
    f'docker exec deploy-openclaw-gateway-1 '
    f'curl -sN http://host.docker.internal:9090/api/chat '
    f'-H "Content-Type: application/json" '
    f'-d "{inner_body}" --max-time 90',
    timeout=100
)

print(f"Response ({len(out)} chars):")
for line in out.split('\n'):
    line = line.strip()
    if line.startswith('data: '):
        try:
            data = json.loads(line[6:])
            dtype = data.get('type', '')
            if dtype == 'result':
                print(f"  [RESULT] {json.dumps(data.get('result', ''), ensure_ascii=False)[:500]}")
            elif dtype == 'assistant':
                msg = data.get('message', {})
                for block in msg.get('content', []):
                    if block.get('type') == 'text':
                        print(f"  [TEXT] {block['text'][:300]}")
            elif 'exit_code' in data:
                print(f"  [DONE] exit_code={data['exit_code']}")
            elif 'session_id' in data and 'uuid' in data:
                print(f"  [SESSION] {data['session_id']}")
            elif 'text' in data:
                print(f"  [LOG] {data['text'][:200]}")
        except:
            pass

# Check bridge log
print("\n=== Bridge log ===")
out, _ = run("tail -10 /Users/fangjin/cc-bridge/bridge.log")
print(out)

mac.close()
print("\n[DONE]")
