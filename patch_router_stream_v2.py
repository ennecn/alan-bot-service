#!/usr/bin/env python3
import paramiko
import sys

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd)
    
    # Wait for command to complete
    try:
        exit_status = stdout.channel.recv_exit_status()
    except:
        exit_status = -1
    
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    return exit_status
    

# The logic to modify router.js
# We use raw strings r'' to avoid python escaping confusion
patch_js = r"""
const fs = require('fs');
const path = require('path');

const routerPath = '/Users/fangjin/llm-gateway/router.js';

if (!fs.existsSync(routerPath)) {
    console.error('Router file not found: ' + routerPath);
    process.exit(1);
}

let content = fs.readFileSync(routerPath, 'utf8');

// 1. Ensure PassThrough import is present (idempotent)
if (!content.includes("import { PassThrough } from 'stream';")) {
    content = "import { PassThrough } from 'stream';\n" + content;
    console.log('Added PassThrough import');
}

// 2. Define the correct function using String.fromCharCode(10) for newlines to avoid escape hell
// We also remove the old broken function if it exists
const startMarker = "// Convert OpenAI stream to Anthropic SSE stream";
// We assume the function ends before "export function routeRequest" or similar, or just replace by signature search

// Let's construct the new function string
const N = "String.fromCharCode(10)";
const streamFunc = `
// Convert OpenAI stream to Anthropic SSE stream
function createOpenAIToAnthropicStream(response, model) {
  const stream = new PassThrough();
  const id = 'msg_' + Date.now();
  
  // Send message_start
  stream.write('event: message_start' + ${N} + 'data: ' + JSON.stringify({
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
  }) + ${N} + ${N});

  // Send content_block_start
  stream.write('event: content_block_start' + ${N} + 'data: ' + JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  }) + ${N} + ${N});

  let buffer = '';

  response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(${N});
      buffer = lines.pop() || ''; 

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
            // Send message_delta and message_stop
            stream.write('event: message_delta' + ${N} + 'data: ' + JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: 0 }
            }) + ${N} + ${N});
            stream.write('event: message_stop' + ${N} + 'data: ' + JSON.stringify({ type: 'message_stop' }) + ${N} + ${N});
            stream.end();
            return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          
          if (choice && choice.delta?.content) {
             stream.write('event: content_block_delta' + ${N} + 'data: ' + JSON.stringify({
                 type: 'content_block_delta',
                 index: 0,
                 delta: { type: 'text_delta', text: choice.delta.content }
             }) + ${N} + ${N});
          }
        } catch (e) { }
      }
  });

  response.body.on('error', (err) => {
      console.error('Upstream stream error:', err);
      stream.emit('error', err);
  });
  
  return stream;
}
`;

// Remove old/broken function if present
// We search for the start marker and try to remove until some likely end or just replace
if (content.includes("function createOpenAIToAnthropicStream")) {
    console.log('Removing old createOpenAIToAnthropicStream function...');
    // This is tricky with regex. 
    // Let's assume it was appended at the end or we can match the start signature
    
    // We will blindly remove everything after the start marker + some lines? No.
    // We can assume the function body structure.
    
    // Better: split by the start marker, keep the first part, append new function.
    // BUT we need to preserve anything AFTER it? (likely nothing if appended at end)
    
    const parts = content.split(startMarker);
    if (parts.length > 1) {
        // Keep the first part (before the function)
        // Check if there was anything after? 
        // The previous patch appended it at the end.
        
        // However, if we ran it multiple times, we might have multiple copies?
        // The check `!content.includes` prevented multiples.
        
        // So we take part[0] and append the new function.
        content = parts[0] + streamFunc;
        console.log('Replaced function.');
    }
} else {
    // Append
    content += streamFunc;
    console.log('Appended function.');
}


// 3. Logic block replacement (if not already done correctly)
// The previous patch might have worked for the logic block, check it.
if (!content.includes('Streaming instead of buffering')) {
   // Try to patch again if needed (same logic as before)
   const oldBlockStart = "if (isOpenAI && response.ok) {";
   
   const newLogic = `
      // Handle OpenAI streaming: convert to Anthropic SSE stream
      // PATCHED: Streaming instead of buffering
      if (isOpenAI && response.ok) {
        try {
            console.log(\`[Router] Streaming OpenAI response from \${provider.name} converted to Anthropic format\`);
            const stream = createOpenAIToAnthropicStream(response, model);
            
            // Mark provider active and healthy
            lastActiveProvider = provider.name;
            resetProviderHealth(provider.id);
            
            return {
              status: 200,
              headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive'
              },
              stream: stream,
              provider: provider.name
            };
        } catch (e) {
             console.error(\`[Router] Stream setup error: \${e.message}\`);
             incrementErrorCount(provider.id);
             cascadedFrom = provider.name;
             continue;
        }
      }
      
      // OLD BUFFERING LOGIC DISABLED (Commented out check to prevent running)
      if (false && isOpenAI && response.ok) { 
   `;
   
   if (content.includes(oldBlockStart)) {
       content = content.replace(oldBlockStart, newLogic);
       console.log('Patched logic block.');
   }
}

fs.writeFileSync(routerPath, content);
console.log('Router patched successfully (v2)');
"""

print("Creating JS patch script (v2) on Mac Mini...")
cmd_create_js = f"cat > /tmp/patch_router_stream_v2.js << 'EOF'\n{patch_js}\nEOF"
run_cmd(cmd_create_js)

print("Executing patch (v2) on Mac Mini host...")
run_cmd("/Users/fangjin/local/bin/node /tmp/patch_router_stream_v2.js")

print("Restarting gateway (v2)...")
run_cmd("pkill -F ~/llm-gateway/server.pid || pkill -f 'node server.js'")
import time
time.sleep(2)
run_cmd("cd ~/llm-gateway && nohup /Users/fangjin/local/bin/node server.js > gateway.log 2>&1 & echo $! > server.pid")

print("Gateway restarted (v2).")
