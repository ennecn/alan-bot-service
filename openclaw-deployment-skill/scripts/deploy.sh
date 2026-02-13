#!/bin/bash
# OpenClaw Digital Ocean Deployment Script
# Version: 1.0.0

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
SSH_PORT=22
OPENCLAW_PORT=18789
GATEWAY_TOKEN="mysecrettoken123"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
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
        --telegram-token)
            TELEGRAM_TOKEN="$2"
            shift 2
            ;;
        --discord-token)
            DISCORD_TOKEN="$2"
            shift 2
            ;;
        --brave-api-key)
            BRAVE_API_KEY="$2"
            shift 2
            ;;
        --tavily-api-key)
            TAVILY_API_KEY="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host              SSH host IP address"
            echo "  --port              SSH port (default: 22)"
            echo "  --key               Path to SSH private key"
            echo "  --api-url           Custom Claude API URL"
            echo "  --api-key           Custom Claude API key"
            echo "  --telegram-token    Telegram bot token"
            echo "  --discord-token     Discord bot token"
            echo "  --brave-api-key     Brave Search API key"
            echo "  --tavily-api-key    Tavily Search API key"
            echo "  --help              Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Interactive mode if no arguments provided
if [ -z "$SSH_HOST" ]; then
    log_info "Starting interactive deployment..."
    echo ""
    read -p "SSH Host IP: " SSH_HOST
    read -p "SSH Port (default: 22): " input_port
    SSH_PORT=${input_port:-22}
    read -p "SSH Key Path (default: ~/.ssh/id_ed25519): " input_key
    SSH_KEY=${input_key:-~/.ssh/id_ed25519}

    echo ""
    log_info "API Configuration"
    read -p "Custom API URL: " API_URL
    read -p "Custom API Key: " API_KEY

    echo ""
    log_info "Channel Configuration (press Enter to skip)"
    read -p "Telegram Bot Token: " TELEGRAM_TOKEN
    read -p "Discord Bot Token: " DISCORD_TOKEN

    echo ""
    log_info "Optional API Keys (press Enter to skip)"
    read -p "Brave Search API Key: " BRAVE_API_KEY
    read -p "Tavily Search API Key: " TAVILY_API_KEY
fi

# Validate required parameters
if [ -z "$SSH_HOST" ] || [ -z "$API_URL" ] || [ -z "$API_KEY" ]; then
    log_error "Missing required parameters: --host, --api-url, --api-key"
    exit 1
fi

log_info "Deployment Configuration:"
echo "  SSH Host: $SSH_HOST:$SSH_PORT"
echo "  API URL: $API_URL"
echo "  Telegram: $([ -n "$TELEGRAM_TOKEN" ] && echo 'Configured' || echo 'Skipped')"
echo "  Discord: $([ -n "$DISCORD_TOKEN" ] && echo 'Configured' || echo 'Skipped')"
echo ""

read -p "Continue with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warn "Deployment cancelled"
    exit 0
fi

SSH_CMD="ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST"

# Step 1: Check server connectivity
log_info "Step 1/8: Checking server connectivity..."
if $SSH_CMD "echo 'Connection successful'" > /dev/null 2>&1; then
    log_info "✓ Server connection established"
else
    log_error "Cannot connect to server"
    exit 1
fi

# Step 2: Install Docker
log_info "Step 2/8: Installing Docker..."
$SSH_CMD "bash -s" << 'ENDSSH'
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    echo "Docker installed successfully"
else
    echo "Docker already installed"
fi
ENDSSH

# Step 3: Clone and build OpenClaw
log_info "Step 3/8: Setting up OpenClaw..."
$SSH_CMD "bash -s" << 'ENDSSH'
cd /root
if [ ! -d "openclaw" ]; then
    git clone https://github.com/openclaw-ai/openclaw.git
    cd openclaw
    docker build -t openclaw:local .
else
    echo "OpenClaw directory already exists"
fi
ENDSSH

# Step 4: Create API proxy
log_info "Step 4/8: Creating API proxy..."
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

# Step 5: Create docker-compose.yml
log_info "Step 5/8: Creating docker-compose configuration..."
cat > /tmp/docker-compose.yml << EOF
services:
  openclaw-gateway:
    image: openclaw:local
    network_mode: host
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: $GATEWAY_TOKEN
      ANTHROPIC_BASE_URL: http://127.0.0.1:8022
      ANTHROPIC_API_KEY: $API_KEY
      $([ -n "$TAVILY_API_KEY" ] && echo "TAVILY_API_KEY: $TAVILY_API_KEY")
      DISPLAY: :99
    volumes:
      - ./config:/home/node/.openclaw
      - ./workspace:/home/node/.openclaw/workspace
    init: true
    restart: unless-stopped
    command:
      - node
      - dist/index.js
      - gateway
      - --bind
      - lan
      - --port
      - '$OPENCLAW_PORT'
      - --allow-unconfigured
EOF

scp -P $SSH_PORT -i "$SSH_KEY" /tmp/docker-compose.yml root@$SSH_HOST:/root/openclaw/docker-compose.yml
rm /tmp/docker-compose.yml

# Step 6: Create systemd services
log_info "Step 6/8: Creating systemd services..."
$SSH_CMD "bash -s" << 'ENDSSH'
# OpenClaw main service
cat > /etc/systemd/system/openclaw.service << 'EOF'
[Unit]
Description=OpenClaw Gateway Service
After=docker.service
Requires=docker.service

[Service]
Type=forking
RemainAfterExit=yes
WorkingDirectory=/root/openclaw
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
ExecStartPost=/bin/bash /root/openclaw/startup-patch.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# API Proxy service
cat > /etc/systemd/system/openclaw-proxy.service << 'EOF'
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

systemctl daemon-reload
systemctl enable openclaw openclaw-proxy
echo "Systemd services created"
ENDSSH

# Step 7: Create startup patch script
log_info "Step 7/8: Creating startup script..."
$SSH_CMD "cat > /root/openclaw/startup-patch.sh" << 'ENDSSH'
#!/bin/bash
echo "[$(date)] Starting OpenClaw startup patch..."
sleep 5

# Patch models.generated.js
docker exec openclaw-openclaw-gateway-1 sed -i 's|https://api.anthropic.com|http://127.0.0.1:8022|g' \
  /app/node_modules/.pnpm/@mariozechner+pi-ai@*/node_modules/@mariozechner/pi-ai/dist/models.generated.js

echo "[$(date)] Patch applied successfully!"

# Ensure proxy service is running
if systemctl is-active --quiet openclaw-proxy.service; then
    echo "[$(date)] API Proxy service is running"
else
    systemctl start openclaw-proxy.service
fi

# Install Chromium if needed
if ! docker exec openclaw-openclaw-gateway-1 which chromium > /dev/null 2>&1; then
    echo "[$(date)] Installing Chromium..."
    docker exec -u root openclaw-openclaw-gateway-1 apt-get update -qq
    docker exec -u root openclaw-openclaw-gateway-1 apt-get install -y --no-install-recommends \
        chromium chromium-sandbox xvfb x11vnc fonts-liberation fonts-noto-color-emoji > /dev/null 2>&1
fi

# Start Xvfb
if ! docker exec openclaw-openclaw-gateway-1 pgrep -f 'Xvfb :99' > /dev/null 2>&1; then
    docker exec -d -u root openclaw-openclaw-gateway-1 sh -c 'Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp > /tmp/xvfb.log 2>&1'
fi

# Restart gateway
docker exec openclaw-openclaw-gateway-1 pkill -f 'openclaw-gateway' || true
sleep 2

echo "[$(date)] Startup configuration complete!"
ENDSSH

$SSH_CMD "chmod +x /root/openclaw/startup-patch.sh"

# Step 8: Start services
log_info "Step 8/8: Starting OpenClaw services..."
$SSH_CMD "systemctl start openclaw"
sleep 10

log_info "Deployment complete!"
echo ""
echo "========================================="
echo "OpenClaw is now running!"
echo "========================================="
echo ""
echo "Gateway URL: http://$SSH_HOST:$OPENCLAW_PORT/?token=$GATEWAY_TOKEN"
echo ""
echo "Useful commands:"
echo "  Check status: ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'systemctl status openclaw openclaw-proxy'"
echo "  View logs:    ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'docker logs openclaw-openclaw-gateway-1 -f'"
echo "  Restart:      ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'systemctl restart openclaw'"
echo ""
log_info "Next steps:"
echo "  1. Configure channels (Telegram/Discord) if not done"
echo "  2. Install additional skills: docker exec openclaw-openclaw-gateway-1 npx clawhub@latest install <skill>"
echo "  3. Run doctor: docker exec openclaw-openclaw-gateway-1 node dist/index.js doctor"
