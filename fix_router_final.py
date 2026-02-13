import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Read file as bytes to preserve exact line endings
sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')
sftp.close()

# Use the exact text with \r\n
old_text = "      } else {\r\n        proxyBody = { ...requestBody, model: actualModel };\r\n      }\r\n\r\n      // Build headers based on API format"

new_text = """      } else {\r
        proxyBody = { ...requestBody, model: actualModel };\r
        // Sanitize request for Gemini-backed providers (e.g. Antigravity)\r
        // Strip fields that Gemini API doesn't understand to prevent\r
        // "Unknown name effortLevel at generation_config" errors\r
        if (actualModel.startsWith('gemini-')) {\r
          delete proxyBody.thinking;\r
          delete proxyBody.metadata;\r
          // Strip cache_control from system prompts\r
          if (Array.isArray(proxyBody.system)) {\r
            proxyBody.system = proxyBody.system.map(s => {\r
              const { cache_control, ...rest } = s;\r
              return rest;\r
            });\r
          }\r
          // Strip cache_control and thinking blocks from messages\r
          if (Array.isArray(proxyBody.messages)) {\r
            proxyBody.messages = proxyBody.messages.map(msg => {\r
              const { cache_control, ...rest } = msg;\r
              if (Array.isArray(rest.content)) {\r
                rest.content = rest.content\r
                  .filter(block => block.type !== 'thinking')\r
                  .map(block => {\r
                    const { cache_control, ...blockRest } = block;\r
                    return blockRest;\r
                  });\r
              }\r
              return rest;\r
            });\r
          }\r
          console.log(`[Router] Sanitized request for Gemini model: ${actualModel} (stripped thinking, cache_control)`);\r
        }\r
      }\r
\r
      // Build headers based on API format"""

if old_text in content:
    patched = content.replace(old_text, new_text, 1)
    print("[OK] Found exact match, patching...")
    
    sftp = mac.open_sftp()
    with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
        f.write(patched.encode('utf-8'))
    sftp.close()
    print("[OK] router.js patched")
else:
    # Try without \r
    old_text2 = "      } else {\n        proxyBody = { ...requestBody, model: actualModel };\n      }\n\n      // Build headers based on API format"
    if old_text2 in content:
        print("[OK] Found match (LF only), patching...")
        new_text2 = new_text.replace('\r\n', '\n').replace('\r', '')
        patched = content.replace(old_text2, new_text2, 1)
        sftp = mac.open_sftp()
        with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
            f.write(patched.encode('utf-8'))
        sftp.close()
        print("[OK] router.js patched")
    else:
        print("[ERROR] Still can't match. Let me try line-by-line approach...")
        # Last resort: find L407 and insert after it
        lines = content.split('\n')
        target_line_idx = None
        for i, line in enumerate(lines):
            stripped = line.rstrip('\r')
            if stripped == '        proxyBody = { ...requestBody, model: actualModel };':
                target_line_idx = i
                break
        
        if target_line_idx is not None:
            print(f"  Found target at line {target_line_idx + 1}")
            # Find the closing brace "      }" after this line
            close_idx = target_line_idx + 1
            # The next line should be "      }"
            
            insert_block = [
                '        // Sanitize request for Gemini-backed providers (e.g. Antigravity)',
                '        // Strip fields that Gemini API doesn\'t understand to prevent',
                '        // "Unknown name effortLevel at generation_config" errors',
                '        if (actualModel.startsWith(\'gemini-\')) {',
                '          delete proxyBody.thinking;',
                '          delete proxyBody.metadata;',
                '          // Strip cache_control from system prompts',
                '          if (Array.isArray(proxyBody.system)) {',
                '            proxyBody.system = proxyBody.system.map(s => {',
                '              const { cache_control, ...rest } = s;',
                '              return rest;',
                '            });',
                '          }',
                '          // Strip cache_control and thinking blocks from messages',
                '          if (Array.isArray(proxyBody.messages)) {',
                '            proxyBody.messages = proxyBody.messages.map(msg => {',
                '              const { cache_control, ...rest } = msg;',
                '              if (Array.isArray(rest.content)) {',
                '                rest.content = rest.content',
                '                  .filter(block => block.type !== \'thinking\')',
                '                  .map(block => {',
                '                    const { cache_control, ...blockRest } = block;',
                '                    return blockRest;',
                '                  });',
                '              }',
                '              return rest;',
                '            });',
                '          }',
                '          console.log(`[Router] Sanitized request for Gemini model: ${actualModel} (stripped thinking, cache_control)`);',
                '        }',
            ]
            
            # Detect line ending style
            eol = '\r\n' if '\r\n' in content else '\n'
            
            # Insert after target line
            for j, insert_line in enumerate(insert_block):
                lines.insert(target_line_idx + 1 + j, insert_line + ('\r' if eol == '\r\n' else ''))
            
            patched = '\n'.join(lines)
            sftp = mac.open_sftp()
            with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
                f.write(patched.encode('utf-8'))
            sftp.close()
            print("[OK] router.js patched via line insertion")
        else:
            print("[FATAL] Cannot find target line")
            sys.exit(1)

# Restart Gateway
print("\nRestarting LLM Gateway...")
def run_cmd(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

pid_out = run_cmd('lsof -i :8080 -t 2>/dev/null | head -1')
if pid_out:
    print(f"  Killing PID {pid_out}...")
    run_cmd(f'kill {pid_out}')
    time.sleep(2)

run_cmd('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
time.sleep(4)

new_pid = run_cmd('lsof -i :8080 -t 2>/dev/null | head -1')
if new_pid:
    print(f"  [OK] Gateway restarted (PID: {new_pid})")
else:
    print("  [WARN] Checking startup logs...")
    print(run_cmd('tail -20 /tmp/gateway.log'))

# Test
print("\n=== Testing with thinking parameter ===")
time.sleep(2)

test_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say exactly three words: fix verified OK"}],
    "max_tokens": 50,
    "thinking": {"type": "enabled", "budget_tokens": 5000}
})
result = run_cmd(
    f"curl -s http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 30"
)
print(f"Response: {result[:800]}")

# Check if 400 error
if '400' in result and 'effortLevel' in result:
    print("\n[FAIL] Still getting effortLevel error!")
elif '"content"' in result or '"text"' in result:
    print("\n[SUCCESS] Request processed without effortLevel error!")
else:
    print(f"\n[INFO] Check response above")

# Show relevant logs
logs = run_cmd('tail -15 /tmp/gateway.log 2>/dev/null')
print(f"\nGateway logs:")
for line in logs.split('\n'):
    if any(kw in line for kw in ['Sanitize', 'sanitize', 'Router', 'Gemini', 'error', 'Error']):
        print(f"  {line}")

mac.close()
print("\n[DONE]")
