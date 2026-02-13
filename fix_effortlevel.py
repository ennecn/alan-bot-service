import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Read router.js
router_content = run('cat /Users/fangjin/llm-gateway/router.js')

# Find the exact section to patch
# We need to add sanitization when forwarding to Antigravity
# The key section is around line 400-410 where proxyBody is built

# The fix: When routing to a provider that uses Antigravity (gemini backend),
# strip fields that Gemini doesn't support: thinking, metadata, etc.

old_code = '''      // Build request body with actual model
      let proxyBody;
      if (isOpenAI) {
        proxyBody = convertAnthropicToOpenAI({ ...requestBody, model: actualModel });
        // Enable streaming for OpenAI providers
        proxyBody.stream = true;
      } else {
        proxyBody = { ...requestBody, model: actualModel };
      }'''

new_code = '''      // Build request body with actual model
      let proxyBody;
      if (isOpenAI) {
        proxyBody = convertAnthropicToOpenAI({ ...requestBody, model: actualModel });
        // Enable streaming for OpenAI providers
        proxyBody.stream = true;
      } else {
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
          // Strip cache_control from messages
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
      }'''

if old_code in router_content:
    patched = router_content.replace(old_code, new_code)
    print("[OK] Found target code block, applying patch...")
    
    # Write patched file
    sftp = mac.open_sftp()
    with sftp.open('/Users/fangjin/llm-gateway/router.js', 'w') as f:
        f.write(patched)
    sftp.close()
    print("[OK] router.js patched")
    
    # Restart the Gateway
    print("\nRestarting LLM Gateway...")
    
    # Find current PID
    pid_out = run('lsof -i :8080 -t 2>/dev/null | head -1')
    if pid_out:
        print(f"  Killing existing Gateway (PID: {pid_out})...")
        run(f'kill {pid_out}')
        import time
        time.sleep(2)
    
    # Start Gateway
    run('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
    import time
    time.sleep(3)
    
    # Verify it started
    new_pid = run('lsof -i :8080 -t 2>/dev/null | head -1')
    if new_pid:
        print(f"  [OK] Gateway restarted (PID: {new_pid})")
    else:
        print("  [WARN] Gateway may not have started, checking logs...")
        logs = run('tail -20 /tmp/gateway.log 2>/dev/null')
        print(f"  {logs}")
    
    # Test request
    print("\nTesting with a request that includes thinking parameter...")
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
    print(f"  Response: {result[:800]}")
    
    # Check for the sanitization log
    logs = run('tail -10 /tmp/gateway.log 2>/dev/null')
    print(f"\nGateway logs:")
    for line in logs.split('\n'):
        if 'Sanitize' in line or 'Router' in line or 'error' in line.lower():
            print(f"  {line}")

else:
    print("[ERROR] Could not find target code block in router.js")
    # Show what's around line 400
    lines = router_content.split('\n')
    for i in range(395, min(415, len(lines))):
        print(f"  L{i+1}: {lines[i]}")

mac.close()
print("\n[DONE]")
