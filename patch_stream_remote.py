import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Write a Node.js patcher script to Mac Mini
patcher = r'''
const fs = require('fs');
const path = '/Users/fangjin/llm-gateway/router.js';
let content = fs.readFileSync(path, 'utf-8');

// Find the old function
const marker = '// Convert OpenAI stream to Anthropic SSE stream';
const startIdx = content.indexOf(marker);
if (startIdx === -1) {
  console.log('ERROR: Could not find stream function marker');
  process.exit(1);
}

// Find the end - last closing brace of the function before EOF or next export
// The function is the last thing in the file
const endMarker = content.length;
// Actually find the closing "}" of the function - it's at the very end
let braceCount = 0;
let funcStart = content.indexOf('{', startIdx);
let funcEnd = -1;
for (let i = funcStart; i < content.length; i++) {
  if (content[i] === '{') braceCount++;
  if (content[i] === '}') {
    braceCount--;
    if (braceCount === 0) {
      funcEnd = i + 1;
      break;
    }
  }
}

if (funcEnd === -1) {
  console.log('ERROR: Could not find function end');
  process.exit(1);
}

console.log(`Found function at ${startIdx}-${funcEnd} (${funcEnd - startIdx} chars)`);

const newFunc = `// Convert OpenAI stream to Anthropic SSE stream (Claude Code SDK compatible)
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
}`;

content = content.substring(0, startIdx) + newFunc + content.substring(funcEnd);
fs.writeFileSync(path, content);
console.log('OK: Stream function replaced');
'''

sftp = mac.open_sftp()
with sftp.open('/tmp/patch_stream.js', 'w') as f:
    f.write(patcher)
sftp.close()

print(run('/opt/homebrew/bin/node /tmp/patch_stream.js'))

# Restart Gateway
print("\nRestarting Gateway...")
pid = run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')
if pid:
    run(f'kill {pid}')
    time.sleep(2)
run(f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /tmp/gateway.log 2>&1 & echo $! > server.pid')
time.sleep(3)
print(f"  Gateway PID: {run(f'{PATH_PREFIX} && lsof -i :8080 -t 2>/dev/null | head -1')}")

# Quick SSE check
print("\n=== Quick SSE test ===")
test_body = json.dumps({
    "model": "claude-sonnet-4-5-thinking",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 30,
    "stream": True
})
raw = run(
    f"curl -sN http://127.0.0.1:8080/v1/messages "
    f"-H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' "
    f"-H 'anthropic-version: 2023-06-01' "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body}' --max-time 20",
    timeout=30
)
print(raw[:2000])

# Restart Bridge and test
print("\n\n=== Restart Bridge ===")
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

# Bridge test
print("\n=== Bridge E2E test ===")
test_body2 = json.dumps({
    "session_id": "test-final",
    "message": "List files in the current directory. Reply with just filenames, one per line.",
    "working_directory": "/Users/fangjin/llm-gateway"
})
result = run(
    f"curl -sN http://127.0.0.1:9090/api/chat "
    f"-H 'Content-Type: application/json' "
    f"-d '{test_body2}' --max-time 120",
    timeout=150
)
print("Response:")
for line in result.split('\n'):
    if line.startswith('data:'):
        try:
            d = json.loads(line[5:].strip())
            t = d.get('type', '')
            if t == 'assistant':
                for block in d.get('message', {}).get('content', []):
                    if block.get('type') == 'text':
                        print(f"  [CLAUDE] {block['text'][:500]}")
                    elif block.get('type') == 'tool_use':
                        print(f"  [TOOL] {block.get('name')}: {str(block.get('input', ''))[:200]}")
            elif t == 'result':
                print(f"  [RESULT] turns={d.get('num_turns')}, cost=${d.get('total_cost_usd')}")
                if d.get('result'):
                    print(f"  {d['result'][:500]}")
                if d.get('errors'):
                    for e in d['errors']:
                        print(f"  [ERR] {str(e)[:300]}")
        except:
            pass

mac.close()
print("\n[DONE]")
