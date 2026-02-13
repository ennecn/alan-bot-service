#!/bin/bash
# OpenClaw Channels Setup Script
# Configures Telegram and Discord bot integration

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
        --telegram-token)
            TELEGRAM_TOKEN="$2"
            shift 2
            ;;
        --discord-token)
            DISCORD_TOKEN="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host              SSH host IP address"
            echo "  --port              SSH port (default: 22)"
            echo "  --key               Path to SSH private key"
            echo "  --telegram-token    Telegram bot token"
            echo "  --discord-token     Discord bot token"
            echo "  --help              Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Interactive mode if no tokens provided
if [ -z "$TELEGRAM_TOKEN" ] && [ -z "$DISCORD_TOKEN" ]; then
    log_info "Channel Configuration (press Enter to skip)"
    echo ""
    read -p "Telegram Bot Token: " TELEGRAM_TOKEN
    read -p "Discord Bot Token: " DISCORD_TOKEN
fi

# Validate required parameters
if [ -z "$SSH_HOST" ]; then
    log_error "Missing required parameter: --host"
    exit 1
fi

if [ -z "$TELEGRAM_TOKEN" ] && [ -z "$DISCORD_TOKEN" ]; then
    log_warn "No channel tokens provided. Skipping channel configuration."
    exit 0
fi

SSH_PORT=${SSH_PORT:-22}
SSH_KEY=${SSH_KEY:-~/.ssh/id_ed25519}
SSH_CMD="ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST"

log_info "Configuring channels..."
if [ -n "$TELEGRAM_TOKEN" ]; then
    echo "  Telegram: Enabled"
fi
if [ -n "$DISCORD_TOKEN" ]; then
    echo "  Discord: Enabled"
fi
echo ""

# Create openclaw.json configuration
CONFIG_JSON="{"
CONFIG_JSON+="\"channels\":{"

# Add Telegram configuration
if [ -n "$TELEGRAM_TOKEN" ]; then
    CONFIG_JSON+="\"telegram\":{"
    CONFIG_JSON+="\"enabled\":true,"
    CONFIG_JSON+="\"botToken\":\"$TELEGRAM_TOKEN\","
    CONFIG_JSON+="\"dmPolicy\":\"open\","
    CONFIG_JSON+="\"allowFrom\":[\"*\"],"
    CONFIG_JSON+="\"groupPolicy\":\"open\","
    CONFIG_JSON+="\"streamMode\":\"partial\""
    CONFIG_JSON+="}"
    if [ -n "$DISCORD_TOKEN" ]; then
        CONFIG_JSON+=","
    fi
fi

# Add Discord configuration
if [ -n "$DISCORD_TOKEN" ]; then
    CONFIG_JSON+="\"discord\":{"
    CONFIG_JSON+="\"enabled\":true,"
    CONFIG_JSON+="\"token\":\"$DISCORD_TOKEN\","
    CONFIG_JSON+="\"groupPolicy\":\"open\","
    CONFIG_JSON+="\"dm\":{"
    CONFIG_JSON+="\"policy\":\"open\","
    CONFIG_JSON+="\"allowFrom\":[\"*\"]"
    CONFIG_JSON+="}"
    CONFIG_JSON+="}"
fi

CONFIG_JSON+="}}"

# Upload configuration
log_info "Step 1/2: Uploading channel configuration..."
$SSH_CMD "mkdir -p /root/openclaw/config"
$SSH_CMD "echo '$CONFIG_JSON' | jq '.' > /root/openclaw/config/openclaw.json"

# Restart OpenClaw to apply changes
log_info "Step 2/2: Restarting OpenClaw to apply changes..."
$SSH_CMD "cd /root/openclaw && docker compose restart"

log_info "✓ Channels configured successfully!"
echo ""

if [ -n "$TELEGRAM_TOKEN" ]; then
    echo "Telegram Bot Setup:"
    echo "  1. Find your bot username in BotFather"
    echo "  2. Send a message to your bot"
    echo "  3. Test with: @your_bot_username hello"
    echo ""
fi

if [ -n "$DISCORD_TOKEN" ]; then
    echo "Discord Bot Setup:"
    echo "  ⚠️  IMPORTANT: Enable Message Content Intent"
    echo "  1. Go to Discord Developer Portal"
    echo "  2. Your Application → Bot (left sidebar)"
    echo "  3. Scroll to 'Privileged Gateway Intents'"
    echo "  4. Enable: MESSAGE CONTENT INTENT"
    echo "  5. Save Changes"
    echo "  6. Invite bot to your server"
    echo "  7. @mention the bot in a channel"
    echo ""
fi

echo "Check logs: ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST 'docker logs openclaw-openclaw-gateway-1 -f'"
