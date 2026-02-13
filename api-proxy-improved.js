const http = require('http');
const https = require('https');

// Configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // ms: 1s, 2s, 4s
const REQUEST_TIMEOUT = 120000; // 120 seconds

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

// Helper: Sleep function for retry delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Create user-friendly error response
function createErrorResponse(message, details = null) {
  const error = {
    type: 'error',
    error: {
      type: 'api_error',
      message: message
    }
  };

  if (details) {
    console.error('[Proxy] Error details:', details);
  }

  return JSON.stringify(error);
}

// Retry wrapper for forwarding functions
async function withRetry(forwardFn, data, req, res, targetName, attempt = 1) {
  try {
    await forwardFn(data, req, res, attempt);
  } catch (error) {
    console.error(`[Proxy] ${targetName} attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`[Proxy] Retrying ${targetName} in ${delay}ms...`);
      await sleep(delay);
      return withRetry(forwardFn, data, req, res, targetName, attempt + 1);
    } else {
      // All retries exhausted
      console.error(`[Proxy] ${targetName} failed after ${MAX_RETRIES} attempts`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(createErrorResponse(
        '服务暂时不可用，请稍后重试。Service temporarily unavailable, please try again later.',
        error
      ));
    }
  }
}

// Forward to Antigravity with improved error handling
function forwardToAntigravity(data, req, res, attempt = 1) {
  return new Promise((resolve, reject) => {
    const targetBody = JSON.stringify(data);
    console.log(`[Proxy] [Attempt ${attempt}] Routing ${data.model} -> Antigravity (${ANTIGRAVITY_HOST}:${ANTIGRAVITY_PORT})`);

    const options = {
      hostname: ANTIGRAVITY_HOST,
      port: ANTIGRAVITY_PORT,
      path: '/v1/messages',
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(targetBody),
        'x-api-key': ANTIGRAVITY_KEY,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
      }
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let hasData = false;
      let dataChunks = [];

      // Track if we received any data
      proxyRes.on('data', (chunk) => {
        hasData = true;
        dataChunks.push(chunk);
      });

      proxyRes.on('end', () => {
        if (!hasData && proxyRes.statusCode === 200) {
          // Stream ended without data - this is the error we want to catch
          console.error('[Proxy] Antigravity stream ended without sending any chunks');
          reject(new Error('Stream ended without data'));
        } else {
          resolve();
        }
      });

      // Forward response to client
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
      });
      proxyRes.on('end', () => {
        res.end();
      });
    });

    proxyReq.on('error', (e) => {
      console.error('[Proxy] Antigravity connection error:', e.message);
      reject(e);
    });

    proxyReq.on('timeout', () => {
      console.error('[Proxy] Antigravity request timeout');
      proxyReq.destroy();
      reject(new Error('Request timeout'));
    });

    proxyReq.write(targetBody);
    proxyReq.end();
  });
}

// Forward to v3.codesome.cn with improved error handling
function forwardToCodesome(data, req, res, attempt = 1) {
  return new Promise((resolve, reject) => {
    const targetBody = JSON.stringify(data);
    console.log(`[Proxy] [Attempt ${attempt}] Routing ${data.model} -> ${TARGET_HOST}`);

    const options = {
      hostname: TARGET_HOST,
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(targetBody),
        'x-api-key': API_KEY,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let hasData = false;
      let dataChunks = [];

      // Track if we received any data
      proxyRes.on('data', (chunk) => {
        hasData = true;
        dataChunks.push(chunk);
      });

      proxyRes.on('end', () => {
        if (!hasData && proxyRes.statusCode === 200) {
          // Stream ended without data - this is the error we want to catch
          console.error('[Proxy] Codesome stream ended without sending any chunks');
          reject(new Error('Stream ended without data'));
        } else {
          resolve();
        }
      });

      // Forward response to client
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
      });
      proxyRes.on('end', () => {
        res.end();
      });
    });

    proxyReq.on('error', (e) => {
      console.error('[Proxy] Codesome connection error:', e.message);
      reject(e);
    });

    proxyReq.on('timeout', () => {
      console.error('[Proxy] Codesome request timeout');
      proxyReq.destroy();
      reject(new Error('Request timeout'));
    });

    proxyReq.write(targetBody);
    proxyReq.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);

        // Map model name if it exists in our mapping
        if (data.model && MODEL_MAP[data.model]) {
          console.log(`[Proxy] Mapping model: ${data.model} -> ${MODEL_MAP[data.model]}`);
          data.model = MODEL_MAP[data.model];
        }

        // Route to Antigravity for image generation models
        if (data.model && ANTIGRAVITY_MODELS.includes(data.model)) {
          await withRetry(forwardToAntigravity, data, req, res, 'Antigravity');
        } else {
          await withRetry(forwardToCodesome, data, req, res, 'Codesome');
        }

      } catch (e) {
        console.error('[Proxy] Parse error:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(createErrorResponse('Invalid request format'));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      target: TARGET_HOST,
      antigravity: `${ANTIGRAVITY_HOST}:${ANTIGRAVITY_PORT}`,
      config: {
        maxRetries: MAX_RETRIES,
        retryDelays: RETRY_DELAYS,
        timeout: REQUEST_TIMEOUT
      }
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log('[Proxy] Ready on http://127.0.0.1:8022');
  console.log(`[Proxy] Target: ${TARGET_HOST}`);
  console.log(`[Proxy] Antigravity: ${ANTIGRAVITY_HOST}:${ANTIGRAVITY_PORT}`);
  console.log(`[Proxy] Retry config: ${MAX_RETRIES} attempts with delays ${RETRY_DELAYS.join(', ')}ms`);
  console.log(`[Proxy] Request timeout: ${REQUEST_TIMEOUT}ms`);
});

