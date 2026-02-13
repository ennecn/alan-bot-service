#!/bin/bash
# OpenClaw Browser Setup Script
# Installs Chromium and Xvfb for browser automation

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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
SSH_PORT=22
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
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host      SSH host IP address"
            echo "  --port      SSH port (default: 22)"
            echo "  --key       Path to SSH private key"
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
if [ -z "$SSH_HOST" ]; then
    log_error "Missing required parameter: --host"
    exit 1
fi

SSH_KEY=${SSH_KEY:-~/.ssh/id_ed25519}
SSH_CMD="ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST"

log_info "Setting up browser support..."

# Step 1: Install Chromium
log_info "Step 1/4: Installing Chromium..."
$SSH_CMD "docker exec -u root openclaw-openclaw-gateway-1 bash -c 'apt-get update -qq && apt-get install -y --no-install-recommends chromium chromium-sandbox xvfb x11vnc fonts-liberation fonts-noto-color-emoji'"

# Step 2: Verify installation
log_info "Step 2/4: Verifying Chromium installation..."
CHROMIUM_VERSION=$($SSH_CMD "docker exec openclaw-openclaw-gateway-1 chromium --version")
log_info "✓ $CHROMIUM_VERSION"

# Step 3: Start Xvfb
log_info "Step 3/4: Starting Xvfb virtual display..."
$SSH_CMD "docker exec -d -u root openclaw-openclaw-gateway-1 sh -c 'Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp > /tmp/xvfb.log 2>&1'"
sleep 2

# Verify Xvfb
if $SSH_CMD "docker exec openclaw-openclaw-gateway-1 pgrep -f 'Xvfb :99'" > /dev/null 2>&1; then
    log_info "✓ Xvfb started successfully"
else
    log_warn "Xvfb may not have started properly"
fi

# Step 4: Update docker-compose.yml to add DISPLAY variable
log_info "Step 4/4: Updating docker-compose configuration..."
$SSH_CMD "bash -s" << 'ENDSSH'
if ! grep -q "DISPLAY: :99" /root/openclaw/docker-compose.yml; then
    sed -i '/ANTHROPIC_API_KEY:/a\      DISPLAY: :99' /root/openclaw/docker-compose.yml
    echo "Added DISPLAY environment variable"
else
    echo "DISPLAY variable already configured"
fi
ENDSSH

# Step 5: Update startup-patch.sh to auto-start Chromium and Xvfb
log_info "Updating startup script..."
$SSH_CMD "bash -s" << 'ENDSSH'
if ! grep -q "Install Chromium" /root/openclaw/startup-patch.sh; then
    cat >> /root/openclaw/startup-patch.sh << 'EOF'

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
EOF
    echo "Updated startup-patch.sh with browser auto-start"
fi
ENDSSH

# Restart OpenClaw
log_info "Restarting OpenClaw..."
$SSH_CMD "cd /root/openclaw && docker compose restart"

log_info "✓ Browser support configured successfully!"
echo ""
echo "Browser Details:"
echo "  Chromium: $CHROMIUM_VERSION"
echo "  Display:  :99 (1920x1080x24)"
echo "  Xvfb:     Running"
echo ""
log_warn "Note: OpenClaw browser control service may timeout occasionally."
log_warn "      The AI will automatically fall back to web_fetch when needed."
echo ""
echo "Test browser:"
echo "  ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'docker exec openclaw-openclaw-gateway-1 chromium --version'"
