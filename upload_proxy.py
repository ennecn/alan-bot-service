#!/usr/bin/env python3
import paramiko

PROXY_CODE = r'''const http = require('http');

const GATEWAY_HOST = 'host.docker.internal';
const GATEWAY_PORT = 8080;
const CLIENT_API_KEY = 'gw-alin-86f31cca5b0d93189ffca6887138ff41';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetBody = JSON.stringify(data);
        var toolCount = (data.tools && data.tools.length) || 0;
        var msgCount = (data.messages && data.messages.length) || 0;
        console.log('[' + new Date().toISOString() + '] Alin: model=' + data.model + ' stream=' + !!data.stream + ' tools=' + toolCount + ' msgs=' + msgCount);
        if (toolCount > 0) {
          console.log('[Proxy] Tool names: ' + data.tools.map(function(t) { return t.name; }).join(', '));
        }
        const options = {
          hostname: GATEWAY_HOST,
          port: GATEWAY_PORT,
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(targetBody),
            'x-api-key': CLIENT_API_KEY,
            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
          }
        };
        if (req.headers['anthropic-beta']) {
          options.headers['anthropic-beta'] = req.headers['anthropic-beta'];
        }
        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          if (data.stream) {
            let buffer = '';
            let hasToolUse = false;
            proxyRes.on('data', (chunk) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (!line.trim() || line.trim() === 'data: [DONE]') {
                  res.write(line + '\n');
                  continue;
                }
                if (line.startsWith('data: ')) {
                  try {
                    const jsonStr = line.slice(6);
                    const event = JSON.parse(jsonStr);
                    if (event.type === 'content_block_start' && event.content_block && event.content_block.type === 'tool_use') {
                      hasToolUse = true;
                      console.log('[Proxy] Detected tool_use: ' + event.content_block.name);
                    }
                    if (event.type === 'message_delta' && event.delta) {
                      console.log('[Proxy] stop_reason=' + JSON.stringify(event.delta.stop_reason));
                      if (event.delta.stop_reason === '' || event.delta.stop_reason === null) {
                        event.delta.stop_reason = hasToolUse ? 'tool_use' : 'end_turn';
                        console.log('[Proxy] Fixed -> ' + event.delta.stop_reason);
                      }
                    }
                    res.write('data: ' + JSON.stringify(event) + '\n');
                  } catch (e) {
                    res.write(line + '\n');
                  }
                } else {
                  res.write(line + '\n');
                }
              }
            });
            proxyRes.on('end', () => {
              if (buffer.trim()) { res.write(buffer); }
              res.end();
            });
          } else {
            proxyRes.pipe(res);
          }
        });
        proxyReq.on('error', (e) => {
          console.error('[Proxy] Err: ' + e.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: { type: 'proxy_error', message: e.message } }));
        });
        proxyReq.setTimeout(300000, () => {
          proxyReq.destroy(new Error('timeout'));
        });
        proxyReq.write(targetBody);
        proxyReq.end();
      } catch (e) {
        console.error('[Proxy] Parse err: ' + e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', fix: 'v2-debug' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log('[Proxy] Alin ready on 127.0.0.1:8022 (v2-debug)');
});
'''

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

sftp = client.open_sftp()
path = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/api-proxy.js'
with sftp.open(path, 'w') as f:
    f.write(PROXY_CODE)
sftp.close()

# Verify
stdin, stdout, stderr = client.exec_command(f'head -3 {path}')
print(stdout.read().decode())

client.close()
print('Done!')
