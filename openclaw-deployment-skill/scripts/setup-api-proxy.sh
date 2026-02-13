#!/bin/bash
# OpenClaw API Proxy Setup Script
# Configures custom API endpoint with model name mapping

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            SSH_HOST="$2"
            shift 2
            ;;
        --port)
            SSH_PORT="$2"
            shift 2
            ;;
        --key)
            SSH_KEY="$2"
            shift 2
            ;;
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host      SSH host IP address"
            echo "  --port      SSH port (default: 22)"
            echo "  --key       Path to SSH private key"
            echo "  --api-url   Custom Claude API URL (e.g., https://ai.t8star.cn)"
            echo "  --api-key   Custom Claude API key"
            echo "  --help      Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$SSH_HOST" ] || [ -z "$API_URL" ] || [ -z "$API_KEY" ]; then
    log_error "Missing required parameters: --host, --api-url, --api-key"
    exit 1
fi

SSH_PORT=${SSH_PORT:-22}
SSH_KEY=${SSH_KEY:-~/.ssh/id_ed25519}
SSH_CMD="ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST"

log_info "Configuring API proxy for $API_URL"

# Step 1: Create API proxy script
log_info "Step 1/3: Creating API proxy script..."
cat > /tmp/api-proxy.js << 'EOF'
const http = require('http');
const https = require('https');

const MODEL_MAP = {
  "anthropic/claude-opus-4-5": "claude-opus-4-5-20251101-thinking",
  "claude-opus-4-5": "claude-opus-4-5-20251101-thinking"
};

const TARGET_HOST = process.env.TARGET_HOST || 'ai.t8star.cn';
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

        // Map model name
        if (data.model && MODEL_MAP[data.model]) {
          console.log(`Mapping model: ${data.model} -> ${MODEL_MAP[data.model]}`);
          data.model = MODEL_MAP[data.model];
        }

        const targetBody = JSON.stringify(data);

        // Forward request
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

server.listen(8022, '127.0.0.1', () => {
  console.log('Proxy ready on http://127.0.0.1:8022 with enhanced logging');
});
EOF

scp -P $SSH_PORT -i "$SSH_KEY" /tmp/api-proxy.js root@$SSH_HOST:/root/api-proxy.js
rm /tmp/api-proxy.js

# Step 2: Create systemd service
log_info "Step 2/3: Creating systemd service..."
$SSH_CMD "cat > /etc/systemd/system/openclaw-proxy.service" << 'EOF'
[Unit]
Description=OpenClaw API Proxy Service
After=docker.service openclaw.service
Requires=docker.service
PartOf=openclaw.service

[Service]
Type=simple
Restart=always
RestartSec=5
StartLimitInterval=60
StartLimitBurst=3
ExecStartPre=/bin/bash -c 'docker cp /root/api-proxy.js openclaw-openclaw-gateway-1:/tmp/api-proxy.js'
ExecStart=/usr/bin/docker exec openclaw-openclaw-gateway-1 node /tmp/api-proxy.js
ExecStop=/usr/bin/docker exec openclaw-openclaw-gateway-1 pkill -TERM -f 'node /tmp/api-proxy.js'
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw-proxy

[Install]
WantedBy=multi-user.target
EOF

# Step 3: Enable and start service
log_info "Step 3/3: Starting API proxy service..."
$SSH_CMD "systemctl daemon-reload && systemctl enable openclaw-proxy && systemctl start openclaw-proxy"

log_info "✓ API proxy configured successfully!"
echo ""
echo "Proxy listening on: http://127.0.0.1:8022"
echo "Forwarding to: $API_URL"
echo ""
echo "Check status: ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'systemctl status openclaw-proxy'"
echo "View logs:    ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'journalctl -u openclaw-proxy -f'"
