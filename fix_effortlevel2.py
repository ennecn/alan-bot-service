import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Read current router.js
router_content = run('cat /Users/fangjin/llm-gateway/router.js')

old_code = """      } else {
        proxyBody = { ...requestBody, model: actualModel };
      }

      // Build headers based on API format"""

new_code = """      } else {
        proxyBody = { ...requestBody, model: actualModel };
        // Sanitize request for Gemini-backed providers (e.g. Antigravity)
        // Strip fields that Gemini API doesn't understand to prevent
        // "Unknown name effortLevel at generation_config" errors
        if (actualModel.startsWith('gemini-')) {
          delete proxyBody.thinking;
          delete proxyBody.metadata;
          // Strip cache_control from system prompts
          if (Array.isArray(proxyBody.system)) {
            proxyBody.system = proxyBody.system.map(s => {
              const { cache_control, ...rest } = s;
              return rest;
            });
          }
          // Strip cache_control and thinking blocks from messages
          if (Array.isArray(proxyBody.messages)) {
            proxyBody.messages = proxyBody.messages.map(msg => {
              const { cache_control, ...rest } = msg;
              if (Array.isArray(rest.content)) {
                rest.content = rest.content
                  .filter(block => block.type !== 'thinking')
                  .map(block => {
                    const { cache_control, ...blockRest } = block;
                    return blockRest;
                  });
              }
              return rest;
            });
          }
          console.log(`[Router] Sanitized request for Gemini model: ${actualModel} (stripped thinking, cache_control)`);
        }
      }

      // Build headers based on API format"""

if old_code in router_content:
    patched = router_content.replace(old_code, new_code, 1)
    print("[OK] Found target code block, applying patch...")
    
    sftp = mac.open_sftp()
    with sftp.open('/Users/fangjin/llm-gateway/router.js', 'w') as f:
        f.write(patched)
    sftp.close()
    print("[OK] router.js patched successfully")
    
    # Restart Gateway
    print("\nRestarting LLM Gateway...")
    pid_out = run('lsof -i :8080 -t 2>/dev/null | head -1')
    if pid_out:
        print(f"  Killing PID {pid_out}...")
        run(f'kill {pid_out}')
        time.sleep(2)
    
    run('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
    time.sleep(4)
    
    new_pid = run('lsof -i :8080 -t 2>/dev/null | head -1')
    if new_pid:
        print(f"  [OK] Gateway restarted (PID: {new_pid})")
    else:
        print("  [WARN] Checking startup logs...")
        print(run('tail -20 /tmp/gateway.log'))
    
    # Test with thinking parameter (this previously caused the 400 error)
    print("\n=== Test: Request with thinking parameter ===")
    time.sleep(2)
    
    test_body = json.dumps({
        "model": "claude-sonnet-4-5-thinking",
        "messages": [{"role": "user", "content": "Say exactly: fix verified OK"}],
        "max_tokens": 50,
        "thinking": {"type": "enabled", "budget_tokens": 5000}
    })
    result = run(
        f"curl -s http://127.0.0.1:8080/v1/messages "
        f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
        f"-H 'anthropic-version: 2023-06-01' "
        f"-H 'Content-Type: application/json' "
        f"-d '{test_body}' --max-time 30"
    )
    print(f"Response: {result[:600]}")
    
    # Check logs for sanitization
    logs = run('tail -15 /tmp/gateway.log 2>/dev/null')
    print(f"\nGateway logs (recent):")
    for line in logs.split('\n')[-10:]:
        print(f"  {line}")
else:
    print("[ERROR] Could not find exact target code block")
    print("\nSearching for nearby code...")
    for i, line in enumerate(router_content.split('\n'), 1):
        if 'proxyBody' in line and ('requestBody' in line or 'actualModel' in line):
            print(f"  L{i}: {line.rstrip()}")

mac.close()
print("\n[DONE]")
