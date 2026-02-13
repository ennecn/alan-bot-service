import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Read server.js to find where to add the handler
content = run('cat /Users/fangjin/llm-gateway/server.js')

# Find the /v1/messages route to add count_tokens before it
old_marker = "if (pathname === '/v1/messages' && req.method === 'POST')"

if old_marker in content:
    new_code = """// Mock token counting endpoint for Claude Code compatibility
    if (pathname === '/v1/messages/count_tokens' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const messages = data.messages || [];
          // Rough estimate: ~4 chars per token
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
          const estimatedTokens = Math.ceil(totalChars / 4) || 100;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ input_tokens: estimatedTokens }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ input_tokens: 100 }));
        }
      });
      return;
    }

    """ + old_marker

    patched = content.replace(old_marker, new_code, 1)

    sftp = mac.open_sftp()
    with sftp.open('/Users/fangjin/llm-gateway/server.js', 'wb') as f:
        f.write(patched.encode('utf-8'))
    sftp.close()
    print("[OK] server.js patched with /v1/messages/count_tokens handler")

    # Restart Gateway
    print("\nRestarting Gateway...")
    PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
    pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
    if pid:
        run(f'kill {pid}')
        time.sleep(2)
    run(f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
    time.sleep(3)
    new_pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
    print(f"  Gateway PID: {new_pid}")

    # Test count_tokens endpoint
    print("\nTesting /v1/messages/count_tokens...")
    test = run(
        "curl -s http://127.0.0.1:8080/v1/messages/count_tokens "
        "-H 'Content-Type: application/json' "
        "-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
        "-d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello world\"}]}'"
    )
    print(f"  Response: {test}")

else:
    print(f"[ERROR] Could not find marker in server.js")
    # Show nearby code
    for i, line in enumerate(content.split('\n'), 1):
        if '/v1/messages' in line:
            print(f"  L{i}: {line.rstrip()}")

mac.close()
print("\n[DONE]")
