import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import {
  getAllProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  resetProviderHealth,
  getAllSettings,
  getSetting,
  setSetting,
  getRecentLogs,
  getLogStats,
  cleanOldLogs,
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  regenerateClientKey
} from './db.js';
import { routeRequest, getRouterStatus } from './router.js';
import { startHealthChecker, runHealthChecks } from './health-checker.js';
import { notifyStartup } from './telegram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Parse JSON body
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Serve static files
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = join(__dirname, 'public', filePath);

  const ext = filePath.substring(filePath.lastIndexOf('.'));
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Serve index.html for SPA routes
        fs.readFile(join(__dirname, 'public', 'index.html'), (err2, indexContent) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(indexContent);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

// Route handlers
const routes = {
  // Proxy endpoint (main API)
  'POST /v1/messages': async (req, res) => {
    try {
      const body = await parseBody(req);
      const result = await routeRequest(body, req.headers);

      // Handle streaming response
      if (result.stream) {
        res.writeHead(result.status, {
          ...result.headers,
          'X-Provider': result.provider
        });
        result.stream.pipe(res);
        return;
      }

      // Regular response
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'X-Provider': result.provider || 'unknown'
      });
      res.end(JSON.stringify(result.body));
    } catch (error) {
      console.error('[Server] Error:', error);
      sendJson(res, 500, { error: { type: 'server_error', message: error.message } });
    }
  },

  // Health check
  'GET /health': (req, res) => {
    const status = getRouterStatus();
    sendJson(res, 200, {
      status: 'ok',
      ...status
    });
  },

  // Provider management
  'GET /api/providers': (req, res) => {
    const providers = getAllProviders().map(p => ({
      ...p,
      api_keys: JSON.parse(p.api_keys || '[]'),
      supported_models: JSON.parse(p.supported_models || '[]'),
      model_mapping: JSON.parse(p.model_mapping || '{}')
    }));
    sendJson(res, 200, providers);
  },

  'POST /api/providers': async (req, res) => {
    try {
      const body = await parseBody(req);
      const provider = createProvider(body);
      sendJson(res, 201, provider);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  },

  'PUT /api/providers/:id': async (req, res, params) => {
    try {
      const body = await parseBody(req);
      const provider = updateProvider(parseInt(params.id), body);
      if (!provider) {
        return sendJson(res, 404, { error: 'Provider not found' });
      }
      sendJson(res, 200, provider);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  },

  'DELETE /api/providers/:id': (req, res, params) => {
    const deleted = deleteProvider(parseInt(params.id));
    if (!deleted) {
      return sendJson(res, 404, { error: 'Provider not found' });
    }
    sendJson(res, 200, { success: true });
  },

  'POST /api/providers/:id/toggle': (req, res, params) => {
    const provider = getProviderById(parseInt(params.id));
    if (!provider) {
      return sendJson(res, 404, { error: 'Provider not found' });
    }
    const updated = updateProvider(provider.id, { enabled: provider.enabled ? 0 : 1 });
    sendJson(res, 200, updated);
  },

  'POST /api/providers/:id/reset': (req, res, params) => {
    const provider = getProviderById(parseInt(params.id));
    if (!provider) {
      return sendJson(res, 404, { error: 'Provider not found' });
    }
    resetProviderHealth(provider.id);
    sendJson(res, 200, { success: true });
  },

  // Settings
  'GET /api/settings': (req, res) => {
    const settings = getAllSettings();
    // Parse JSON values
    if (settings.allowed_models) {
      settings.allowed_models = JSON.parse(settings.allowed_models);
    }
    sendJson(res, 200, settings);
  },

  'PUT /api/settings': async (req, res) => {
    try {
      const body = await parseBody(req);
      for (const [key, value] of Object.entries(body)) {
        if (Array.isArray(value) || typeof value === 'object') {
          setSetting(key, JSON.stringify(value));
        } else {
          setSetting(key, String(value));
        }
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  },

  // Status and stats
  'GET /api/status': (req, res) => {
    sendJson(res, 200, getRouterStatus());
  },

  'GET /api/stats': (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const since = url.searchParams.get('since');
    const stats = getLogStats(since ? parseInt(since) : null);
    sendJson(res, 200, stats);
  },

  'GET /api/logs': (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const logs = getRecentLogs(limit, offset);
    sendJson(res, 200, logs);
  },

  // Health check trigger
  'POST /api/health-check': async (req, res) => {
    const results = await runHealthChecks();
    sendJson(res, 200, results);
  },

  // Client management
  'GET /api/clients': (req, res) => {
    const clients = getAllClients().map(c => ({
      ...c,
      provider_order: JSON.parse(c.provider_order || '[]'),
      model_mapping: JSON.parse(c.model_mapping || '{}')
    }));
    sendJson(res, 200, clients);
  },

  'POST /api/clients': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body.name) {
        return sendJson(res, 400, { error: 'Name is required' });
      }
      const client = createClient(body);
      sendJson(res, 201, {
        ...client,
        provider_order: JSON.parse(client.provider_order || '[]'),
        model_mapping: JSON.parse(client.model_mapping || '{}')
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  },

  'PUT /api/clients/:id': async (req, res, params) => {
    try {
      const body = await parseBody(req);
      const client = updateClient(parseInt(params.id), body);
      if (!client) {
        return sendJson(res, 404, { error: 'Client not found' });
      }
      sendJson(res, 200, {
        ...client,
        provider_order: JSON.parse(client.provider_order || '[]'),
        model_mapping: JSON.parse(client.model_mapping || '{}')
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  },

  'DELETE /api/clients/:id': (req, res, params) => {
    const deleted = deleteClient(parseInt(params.id));
    if (!deleted) {
      return sendJson(res, 404, { error: 'Client not found' });
    }
    sendJson(res, 200, { success: true });
  },

  'POST /api/clients/:id/regenerate-key': (req, res, params) => {
    const client = regenerateClientKey(parseInt(params.id));
    if (!client) {
      return sendJson(res, 404, { error: 'Client not found' });
    }
    sendJson(res, 200, {
      ...client,
      provider_order: JSON.parse(client.provider_order || '[]'),
      model_mapping: JSON.parse(client.model_mapping || '{}')
    });
  },

  'POST /api/clients/:id/toggle': (req, res, params) => {
    const client = getClientById(parseInt(params.id));
    if (!client) {
      return sendJson(res, 404, { error: 'Client not found' });
    }
    const updated = updateClient(client.id, { enabled: client.enabled ? 0 : 1 });
    sendJson(res, 200, {
      ...updated,
      provider_order: JSON.parse(updated.provider_order || '[]'),
      model_mapping: JSON.parse(updated.model_mapping || '{}')
    });
  },

  // Cascade reset
  'POST /cascade/reset': (req, res) => {
    const providers = getAllProviders();
    for (const provider of providers) {
      resetProviderHealth(provider.id);
    }
    sendJson(res, 200, { success: true, message: 'All providers reset' });
  }
};

// Match route with parameters
function matchRoute(method, path) {
  const key = `${method} ${path}`;

  // Exact match
  if (routes[key]) {
    return { handler: routes[key], params: {} };
  }

  // Pattern match (e.g., /api/providers/:id)
  for (const routeKey of Object.keys(routes)) {
    const [routeMethod, routePath] = routeKey.split(' ');
    if (routeMethod !== method) continue;

    const routeParts = routePath.split('/');
    const pathParts = path.split('/');

    if (routeParts.length !== pathParts.length) continue;

    const params = {};
    let match = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      return { handler: routes[routeKey], params };
    }
  }

  return null;
}

// Create server
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

  // Try to match API route
  const match = matchRoute(req.method, path);
  if (match) {
    try {
      await match.handler(req, res, match.params);
    } catch (error) {
      console.error('[Server] Route error:', error);
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // Serve static files for GET requests
  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  // 404 for unmatched routes
  sendJson(res, 404, { error: 'Not Found' });
});

// Start server
server.listen(PORT, HOST, async () => {
  console.log(`[Server] LLM Gateway running on http://${HOST}:${PORT}`);

  // Start health checker (every 60 seconds)
  startHealthChecker(60000);

  // Clean old logs (keep 7 days)
  const cleaned = cleanOldLogs(7);
  if (cleaned > 0) {
    console.log(`[Server] Cleaned ${cleaned} old log entries`);
  }

  // Send startup notification
  const status = getRouterStatus();
  const activeProvider = status.providers.find(p => p.available)?.name || 'None';
  await notifyStartup(activeProvider, 'auto');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  server.close(() => {
    console.log('[Server] Goodbye!');
    process.exit(0);
  });
});
