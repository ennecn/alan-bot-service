const http = require('http');
const https = require('https');

// Model name mapping
// Add your custom model mappings here
const MODEL_MAP = {
  "anthropic/claude-opus-4-5": "claude-opus-4-5-20251101-thinking",
  "claude-opus-4-5": "claude-opus-4-5-20251101-thinking"
  // Example: "claude-sonnet-4": "claude-sonnet-4-20250514"
};

// Target API endpoint (without https://)
const TARGET_HOST = process.env.TARGET_HOST || 'ai.t8star.cn';

// API key from environment
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        // Map model name if it exists in our mapping
        if (data.model && MODEL_MAP[data.model]) {
          console.log(`Mapping model: ${data.model} -> ${MODEL_MAP[data.model]}`);
          data.model = MODEL_MAP[data.model];
        }

        const targetBody = JSON.stringify(data);

        // Forward request to actual API
        const options = {
          hostname: TARGET_HOST,
          port: 443,
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(targetBody),
            'x-api-key': API_KEY,
            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
          }
        };

        const proxyReq = https.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (e) => {
          console.error('Proxy error:', e);
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });

        proxyReq.write(targetBody);
        proxyReq.end();

      } catch (e) {
        console.error('Parse error:', e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// Listen on localhost only
server.listen(8022, '127.0.0.1', () => {
  console.log('Proxy ready on http://127.0.0.1:8022 with enhanced logging');
});
