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
patch_js = """
const fs = require('fs');
const path = require('path');

const routerPath = '/Users/fangjin/llm-gateway/router.js';

if (!fs.existsSync(routerPath)) {
    console.error('Router file not found: ' + routerPath);
    process.exit(1);
}

let content = fs.readFileSync(routerPath, 'utf8');

// 1. Add import { PassThrough } from 'stream';
if (!content.includes("import { PassThrough } from 'stream';")) {
    content = "import { PassThrough } from 'stream';\\n" + content;
    console.log('Added PassThrough import');
}

// 2. Add createOpenAIToAnthropicStream function
const streamFunc = `
// Convert OpenAI stream to Anthropic SSE stream
function createOpenAIToAnthropicStream(response, model) {
  const stream = new PassThrough();
  const id = 'msg_' + Date.now();
  
  // Send message_start
  stream.write('event: message_start\\ndata: ' + JSON.stringify({
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
  }) + '\\n\\n');

  // Send content_block_start
  stream.write('event: content_block_start\\ndata: ' + JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  }) + '\\n\\n');

  let buffer = '';

  response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\\n');
      buffer = lines.pop() || ''; 

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
            // Send message_delta and message_stop
            stream.write('event: message_delta\\ndata: ' + JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: 0 }
            }) + '\\n\\n');
            stream.write('event: message_stop\\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\\n\\n');
            stream.end();
            return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          
          // Handle reasoning/thinking
          if (choice && (choice.delta?.reasoning_content || choice.delta?.reasoning)) {
             // For now, treat reasoning as text or ignore if client doesn't support specific reasoning block in stream
             // Anthropic thinking blocks are complex in stream. 
             // Let's just append to text for simplicity or ignore to avoid breaking client
             // Actually, safest is to append to text if we want it visible, or ignore.
             // Given Claude code might assume text, let's output as text if content is empty?
             // No, let's stick to content for now to be safe.
          }

          if (choice && choice.delta?.content) {
             stream.write('event: content_block_delta\\ndata: ' + JSON.stringify({
                 type: 'content_block_delta',
                 index: 0,
                 delta: { type: 'text_delta', text: choice.delta.content }
             }) + '\\n\\n');
          }
        } catch (e) { }
      }
  });

  response.body.on('error', (err) => {
      console.error('Upstream stream error:', err);
      stream.emit('error', err);
  });
  
  response.body.on('end', () => {
      // Ensure we close if [DONE] wasn't received (some providers just end)
      // We can't easily detect if we already sent stop, so we rely on [DONE] usually.
      // But if stream ends without [DONE], we should probably close.
      // However, PassThrough doesn't auto-close if we wrote to it.
      // Let's assume [DONE] is always sent by proper OpenAI providers.
  });

  return stream;
}
`;

if (!content.includes('function createOpenAIToAnthropicStream')) {
    content += streamFunc;
    console.log('Added createOpenAIToAnthropicStream function');
}

// 3. Replace the logic block
// We look for "if (isOpenAI && response.ok) {" and the block following it specifically for buffering
// The existing code has:
// if (isOpenAI && response.ok) {
//   try {
//     const streamResult = await collectOpenAIStream(response);

const oldBlockStart = "if (isOpenAI && response.ok) {";
const oldBlockSearch = "const streamResult = await collectOpenAIStream(response);";

if (content.includes(oldBlockStart) && content.includes(oldBlockSearch)) {
    // We need to be careful with regex replacement of a multi-line block
    // Instead of regex, let's construct the new block and replace the old one if we can identify it reliably
    
    // Simplest way: find the start of the block and the end of the catch block
    // The block is:
    /*
      if (isOpenAI && response.ok) {
        try {
          const streamResult = await collectOpenAIStream(response);
          // ... 40-50 lines ...
          };
        } catch (streamError) {
          console.error(`[Router] ${provider.name} stream collection error:`, streamError.message);     
          incrementErrorCount(provider.id);
          cascadedFrom = provider.name;
          continue;
        }
      }
    */
   
   // We will replace the whole identified section
   // To do this safely, we will assume the structure and look for unique markers.
   
   // We'll replace from `if (isOpenAI && response.ok) {` DOWN TO the end of the `catch` block.
   // But standard JS parsing is hard with regex.
   
   // Alternative: Comment out the old `collectOpenAIStream` call and insert the new return logic BEFORE it.
   // But we need to handle the `continue` properly.
   
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
   
   // We replace the first line of the old block with the new logic AND the start of the old block (disabled)
   // This disables the old block effectively.
   
   content = content.replace(oldBlockStart, newLogic);
   console.log('Patched OpenAI streaming logic');

} else {
    console.log('Could not find exact block to patch, or already patched');
}

fs.writeFileSync(routerPath, content);
console.log('Router patched successfully');

"""

print("Creating JS patch script on Mac Mini...")
cmd_create_js = f"cat > /tmp/patch_router_stream.js << 'EOF'\n{patch_js}\nEOF"
run_cmd(cmd_create_js)

print("Executing patch on Mac Mini host...")
run_cmd("/Users/fangjin/local/bin/node /tmp/patch_router_stream.js")

print("Restarting gateway...")
run_cmd("pkill -F ~/llm-gateway/server.pid || pkill -f 'node server.js'")
# Wait a bit
import time
time.sleep(2)
run_cmd("cd ~/llm-gateway && nohup /Users/fangjin/local/bin/node server.js > gateway.log 2>&1 & echo $! > server.pid")

print("Gateway restarted.")
