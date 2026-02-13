const http = require('http');

// Unified LLM Gateway proxy - Alin (with stopReason fix v2)
const GATEWAY_HOST = 'host.docker.internal';
const GATEWAY_PORT = 8080;
const CLIENT_API_KEY = 'gw-alin-86f31cca5b0d93189ffca6887138ff41';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetBody = JSON.stringify(data);

        console.log(`[${new Date().toISOString()}] Alin: model=${data.model} stream=${!!data.stream}`);

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
          // Forward status and headers
          res.writeHead(proxyRes.statusCode, proxyRes.headers);

          // If streaming, intercept and fix stopReason
          if (data.stream) {
            let buffer = '';
            // Track tool_use for THIS request only (not global)
            let hasToolUse = false;

            proxyRes.on('data', (chunk) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop(); // Keep incomplete line in buffer

              for (const line of lines) {
                if (!line.trim() || line.trim() === 'data: [DONE]') {
                  res.write(line + '\n');
                  continue;
                }

                if (line.startsWith('data: ')) {
                  try {
                    const jsonStr = line.slice(6);
                    const event = JSON.parse(jsonStr);

                    // Track tool_use blocks
                    if (event.type === 'content_block_start' &&
                        event.content_block?.type === 'tool_use') {
                      hasToolUse = true;
                      console.log('[Proxy] Detected tool_use block');
                    }

                    // Fix empty stop_reason in message_delta
                    if (event.type === 'message_delta' && event.delta) {
                      if (event.delta.stop_reason === '' || event.delta.stop_reason === null) {
                        // Set appropriate stop_reason based on whether tools were used
                        event.delta.stop_reason = hasToolUse ? 'tool_use' : 'end_turn';
                        console.log(`[Proxy] Fixed empty stop_reason -> ${event.delta.stop_reason}`);
                      }
                    }

                    res.write('data: ' + JSON.stringify(event) + '\n');
                  } catch (e) {
                    // If parse fails, forward as-is
                    res.write(line + '\n');
                  }
                } else {
                  res.write(line + '\n');
                }
              }
            });

            proxyRes.on('end', () => {
              if (buffer.trim()) {
                res.write(buffer);
              }
              res.end();
            });
          } else {
            // Non-streaming: pipe directly (less common for OpenClaw)
            proxyRes.pipe(res);
          }
        });

        proxyReq.on('error', (e) => {
          console.error('[Proxy] Error:', e.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: { type: 'proxy_error', message: e.message } }));
        });

        proxyReq.setTimeout(300000, () => {
          proxyReq.destroy(new Error('Request timeout (300s)'));
        });

        proxyReq.write(targetBody);
        proxyReq.end();

      } catch (e) {
        console.error('[Proxy] Parse error:', e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', target: 'llm-gateway:8080', client: 'Alin', fix: 'stopReason-v2' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log('[Proxy] Alin ready on http://127.0.0.1:8022 -> LLM Gateway (with stopReason fix v2)');
});
