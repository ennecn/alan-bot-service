import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')
sftp.close()

# Replace the entire createOpenAIToAnthropicStream function
old_func = """// Convert OpenAI stream to Anthropic SSE stream
function createOpenAIToAnthropicStream(response, model) {
  const stream = new PassThrough();
  const id = 'msg_' + Date.now();

  // Send message_start
  stream.write('event: message_start' + String.fromCharCode(10) + 'data: ' + JSON.stringify({
    type: 'message_start',
    message: {
      id: id,
      type: 'message',
      role: 'assistant',
      content: [],
      model: model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  }) + String.fromCharCode(10) + String.fromCharCode(10));

  // Send content_block_start
  stream.write('event: content_block_start' + String.fromCharCode(10) + 'data: ' + JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  }) + String.fromCharCode(10) + String.fromCharCode(10));

  let buffer = '';

  response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(String.fromCharCode(10));
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
            // Send message_delta and message_stop
            stream.write('event: message_delta' + String.fromCharCode(10) + 'data: ' + JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: 0 }
            }) + String.fromCharCode(10) + String.fromCharCode(10));
            stream.write('event: message_stop' + String.fromCharCode(10) + 'data: ' + JSON.stringify({ type: 'message_stop' }) + String.fromCharCode(10) + String.fromCharCode(10));
            stream.end();
            return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];

          if (choice && choice.delta?.content) {
             stream.write('event: content_block_delta' + String.fromCharCode(10) + 'data: ' + JSON.stringify({
                 type: 'content_block_delta',
                 index: 0,
                 delta: { type: 'text_delta', text: choice.delta.content }
             }) + String.fromCharCode(10) + String.fromCharCode(10));
          }
        } catch (e) { }
      }
  });

  response.body.on('error', (err) => {
      console.error('Upstream stream error:', err);
      stream.emit('error', err);
  });

  return stream;
}"""

new_func = """// Convert OpenAI stream to Anthropic SSE stream (Claude Code SDK compatible)
function createOpenAIToAnthropicStream(response, model) {
  const stream = new PassThrough();
  const id = 'msg_' + Date.now();
  const NL = String.fromCharCode(10);
  let outputTokens = 0;
  let inputTokens = 0;

  function sse(event, data) {
    stream.write('event: ' + event + NL + 'data: ' + JSON.stringify(data) + NL + NL);
  }

  // Send ping (keeps connection alive, Claude Code SDK expects this)
  sse('ping', { type: 'ping' });

  // Send message_start
  sse('message_start', {
    type: 'message_start',
    message: {
      id: id,
      type: 'message',
      role: 'assistant',
      content: [],
      model: model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    }
  });

  // Send content_block_start
  sse('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  });

  let buffer = '';

  response.body.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(NL);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      if (data === '[DONE]') {
        // Send content_block_stop (required by Claude Code SDK!)
        sse('content_block_stop', {
          type: 'content_block_stop',
          index: 0
        });

        // Send message_delta with usage
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: outputTokens || 1 }
        });

        // Send message_stop
        sse('message_stop', { type: 'message_stop' });
        stream.end();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];

        if (choice && choice.delta?.content) {
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: choice.delta.content }
          });
          // Rough token estimation
          outputTokens += Math.ceil(choice.delta.content.length / 4);
        }

        // Capture usage if provided
        if (parsed.usage) {
          if (parsed.usage.prompt_tokens) inputTokens = parsed.usage.prompt_tokens;
          if (parsed.usage.completion_tokens) outputTokens = parsed.usage.completion_tokens;
        }
      } catch (e) { }
    }
  });

  response.body.on('error', (err) => {
    console.error('Upstream stream error:', err);
    stream.emit('error', err);
  });

  return stream;
}"""

if old_func in content:
    patched = content.replace(old_func, new_func, 1)
    sftp = mac.open_sftp()
    with sftp.open('/Users/fangjin/llm-gateway/router.js', 'wb') as f:
        f.write(patched.encode('utf-8'))
    sftp.close()
    print("[OK] Stream conversion patched (added content_block_stop, ping, token counting)")

    # Restart Gateway
    print("\nRestarting Gateway...")
    PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
    pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
    if pid:
        run(f'kill {pid}')
        time.sleep(2)
    run(f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
    time.sleep(3)
    print(f"  Gateway PID: {run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')}")

    # Test raw SSE
    print("\n=== Raw SSE test ===")
    import json
    test_body = json.dumps({
        "model": "claude-sonnet-4-5-thinking",
        "messages": [{"role": "user", "content": "Say exactly: hello"}],
        "max_tokens": 50,
        "stream": True
    })
    raw = run(
        f"curl -sN http://127.0.0.1:8080/v1/messages "
        f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
        f"-H 'anthropic-version: 2023-06-01' "
        f"-H 'Content-Type: application/json' "
        f"-d '{test_body}' --max-time 30 2>&1",
        timeout=45
    )
    print(raw[:2000])

    # Now retest Bridge
    print("\n\n=== Restart Bridge and retest ===")
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
    print(f"  Bridge: {run('curl -s http://127.0.0.1:9090/health')}")

    # Test Bridge
    test_body2 = json.dumps({
        "session_id": "test-stream-fix",
        "message": "List the files in this directory. Just list the filenames.",
        "working_directory": "/Users/fangjin/llm-gateway"
    })
    result = run(
        f'{PATH_PREFIX} && docker exec deploy-openclaw-gateway-1 '
        f"curl -sN http://host.docker.internal:9090/api/chat "
        f"-H 'Content-Type: application/json' "
        f"-d '{test_body2}' "
        f"--max-time 120 2>&1",
        timeout=150
    )
    print("\nBridge response:")
    for line in result.split('\n'):
        if line.startswith('data:'):
            try:
                d = json.loads(line[5:].strip())
                t = d.get('type', '')
                if t == 'assistant':
                    for block in d.get('message', {}).get('content', []):
                        if block.get('type') == 'text':
                            print(f"  [TEXT] {block['text'][:500]}")
                        elif block.get('type') == 'tool_use':
                            print(f"  [TOOL] {block.get('name')}")
                elif t == 'result':
                    print(f"  [RESULT] turns={d.get('num_turns')}, cost=${d.get('total_cost_usd')}, errors={d.get('errors', [])}")
                    if d.get('result'):
                        print(f"  {d['result'][:500]}")
            except:
                pass
else:
    print("[ERROR] Could not find old function")

mac.close()
print("\n[DONE]")
