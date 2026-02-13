import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Read exact lines around L103
sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/server.js', 'rb') as f:
    content = f.read().decode('utf-8')
sftp.close()

# Find and show context
lines = content.split('\n')
for i, line in enumerate(lines):
    if '/v1/messages' in line:
        print(f"  L{i+1}: {repr(line)}")

# The route is defined as a key in an object: 'POST /v1/messages': async (req, res) => {
# I need to add a new route entry before it
old_text = "  'POST /v1/messages': async (req, res) => {"

new_text = """  // Mock token counting for Claude Code compatibility
  'POST /v1/messages/count_tokens': async (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const messages = data.messages || [];
        let totalChars = 0;
        for (const msg of messages) {
          if (typeof msg.content === 'string') totalChars += msg.content.length;
          else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.text) totalChars += block.text.length;
            }
          }
        }
        if (data.system) {
          if (typeof data.system === 'string') totalChars += data.system.length;
          else if (Array.isArray(data.system)) {
            for (const block of data.system) {
              if (block.text) totalChars += block.text.length;
            }
          }
        }
        // Include tool definitions in count
        if (data.tools) totalChars += JSON.stringify(data.tools).length;
        const estimatedTokens = Math.ceil(totalChars / 4) || 100;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: estimatedTokens }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 100 }));
      }
    });
  },

  'POST /v1/messages': async (req, res) => {"""

if old_text in content:
    patched = content.replace(old_text, new_text, 1)
    sftp = mac.open_sftp()
    with sftp.open('/Users/fangjin/llm-gateway/server.js', 'wb') as f:
        f.write(patched.encode('utf-8'))
    sftp.close()
    print("\n[OK] server.js patched")

    # Restart Gateway
    print("Restarting Gateway...")
    PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
    pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
    if pid:
        run(f'kill {pid}')
        time.sleep(2)
    run(f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
    time.sleep(3)
    new_pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
    print(f"  Gateway PID: {new_pid}")

    # Test
    print("\nTesting /v1/messages/count_tokens...")
    test = run(
        "curl -s http://127.0.0.1:8080/v1/messages/count_tokens "
        "-H 'Content-Type: application/json' "
        "-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
        "-d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello world test\"}]}'"
    )
    print(f"  Response: {test}")

    # Now retest Bridge
    print("\n=== Retest Bridge ===")
    # Kill and restart Bridge
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
    print(f"  Bridge health: {run('curl -s http://127.0.0.1:9090/health')}")

    # Send test task
    print("\n=== Send test task ===")
    test_body = json.dumps({
        "session_id": "test-v2",
        "message": "List files in current directory. Reply with just the filenames, nothing else.",
        "working_directory": "/Users/fangjin/llm-gateway"
    })
    result = run(
        f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
        f"curl -sN http://host.docker.internal:9090/api/chat "
        f"-H 'Content-Type: application/json' "
        f"-d '{test_body}' "
        f"--max-time 60 2>&1",
        timeout=90
    )

    print("Response events:")
    for line in result.split('\n'):
        if not line.strip():
            continue
        if line.startswith('event:'):
            print(f"\n  {line}")
        elif line.startswith('data:'):
            try:
                data = json.loads(line[5:].strip())
                evt_type = data.get('type', '')
                if evt_type == 'assistant':
                    for block in data.get('message', {}).get('content', []):
                        if block.get('type') == 'text' and block.get('text'):
                            print(f"    [TEXT] {block['text'][:500]}")
                        elif block.get('type') == 'tool_use':
                            print(f"    [TOOL] {block.get('name')}: {str(block.get('input', ''))[:200]}")
                elif evt_type == 'tool':
                    content = data.get('message', {}).get('content', '')
                    if isinstance(content, list):
                        for block in content:
                            if block.get('type') == 'tool_result':
                                print(f"    [TOOL_RESULT] {str(block.get('content', ''))[:300]}")
                    elif isinstance(content, str):
                        print(f"    [TOOL_RESULT] {content[:300]}")
                elif evt_type == 'result':
                    result_text = data.get('result', '')[:500]
                    errors = data.get('errors', [])
                    cost = data.get('total_cost_usd', 0)
                    turns = data.get('num_turns', 0)
                    print(f"    [RESULT] turns={turns}, cost=${cost}")
                    if result_text:
                        print(f"    {result_text}")
                    if errors:
                        for e in errors:
                            print(f"    [ERR] {str(e)[:300]}")
                elif evt_type == 'system':
                    pass  # Skip init events
                else:
                    print(f"    {str(data)[:200]}")
            except:
                print(f"  {line[:200]}")
else:
    print("[ERROR] Could not find target in server.js")

mac.close()
print("\n[DONE]")
