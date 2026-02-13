const http = require('http');
const https = require('https');

// Model name mapping
const MODEL_MAP = {
  "anthropic/claude-opus-4-5": "claude-opus-4-5-20251101-thinking",
  "claude-opus-4-5": "claude-opus-4-5-20251101-thinking"
};

// Models that should route to Antigravity (image generation)
const ANTIGRAVITY_MODELS = ['gemini-3-pro-image'];

// Antigravity endpoint (local on Mac Mini via host.docker.internal)
const ANTIGRAVITY_HOST = 'host.docker.internal';
const ANTIGRAVITY_PORT = 8045;
const ANTIGRAVITY_KEY = 'sk-antigravity';

// Default target - v3.codesome.cn
const TARGET_HOST = 'v3.codesome.cn';
const API_KEY = 'sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8';

function forwardToAntigravity(data, req, res) {
  const targetBody = JSON.stringify(data);
  console.log(`[Proxy] Routing ${data.model} -> Antigravity (${ANTIGRAVITY_HOST}:${ANTIGRAVITY_PORT})`);

  const options = {
    hostname: ANTIGRAVITY_HOST,
    port: ANTIGRAVITY_PORT,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(targetBody),
      'x-api-key': ANTIGRAVITY_KEY,
      'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('[Proxy] Antigravity error:', e);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Antigravity unreachable: ' + e.message }));
  });

  proxyReq.write(targetBody);
  proxyReq.end();
}

function forwardToCodesome(data, req, res) {
  const targetBody = JSON.stringify(data);

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
    console.error('[Proxy] Error:', e);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });

  proxyReq.write(targetBody);
  proxyReq.end();
}

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
          console.log(`[Proxy] Mapping model: ${data.model} -> ${MODEL_MAP[data.model]}`);
          data.model = MODEL_MAP[data.model];
        }

        // Route to Antigravity for image generation models
        if (data.model && ANTIGRAVITY_MODELS.includes(data.model)) {
          forwardToAntigravity(data, req, res);
        } else {
          forwardToCodesome(data, req, res);
        }

      } catch (e) {
        console.error('[Proxy] Parse error:', e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', target: 'v3.codesome.cn', antigravity: `${ANTIGRAVITY_HOST}:${ANTIGRAVITY_PORT}` }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log('[Proxy] Ready on http://127.0.0.1:8022 -> v3.codesome.cn + Antigravity');
});
