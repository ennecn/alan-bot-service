#!/bin/bash
# OpenClaw Skills Installation Script
# Installs essential skills from ClawHub

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
INSTALL_ALL=false
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
        --all)
            INSTALL_ALL=true
            shift
            ;;
        --skill)
            CUSTOM_SKILLS+=("$2")
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host      SSH host IP address"
            echo "  --port      SSH port (default: 22)"
            echo "  --key       Path to SSH private key"
            echo "  --all       Install all recommended skills"
            echo "  --skill     Install specific skill (can be used multiple times)"
            echo "  --help      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --host 1.2.3.4 --all"
            echo "  $0 --host 1.2.3.4 --skill tavily-search --skill find-skills"
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

# Default recommended skills
RECOMMENDED_SKILLS=(
    "tavily-search"
    "find-skills"
    "proactive-agent-1-2-4"
)

# Determine which skills to install
if [ "$INSTALL_ALL" = true ]; then
    SKILLS_TO_INSTALL=("${RECOMMENDED_SKILLS[@]}")
elif [ ${#CUSTOM_SKILLS[@]} -gt 0 ]; then
    SKILLS_TO_INSTALL=("${CUSTOM_SKILLS[@]}")
else
    # Interactive mode
    log_info "Recommended Skills:"
    echo ""
    echo "1. tavily-search         - AI-optimized search engine"
    echo "2. find-skills           - Skill discovery tool"
    echo "3. proactive-agent-1-2-4 - Autonomous agent architecture"
    echo ""
    read -p "Install recommended skills? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        SKILLS_TO_INSTALL=("${RECOMMENDED_SKILLS[@]}")
    else
        log_info "Skipping skill installation"
        exit 0
    fi
fi

log_info "Installing ${#SKILLS_TO_INSTALL[@]} skill(s)..."
echo ""

# Install each skill
for skill in "${SKILLS_TO_INSTALL[@]}"; do
    log_info "Installing $skill..."

    # Install skill
    if $SSH_CMD "docker exec openclaw-openclaw-gateway-1 npx clawhub@latest install $skill" 2>&1 | tee /tmp/skill-install.log; then
        log_info "✓ $skill installed successfully"
    else
        log_error "Failed to install $skill"
        cat /tmp/skill-install.log
        continue
    fi

    # Special configuration for specific skills
    case $skill in
        "tavily-search")
            echo ""
            log_info "Tavily Search requires an API key"
            echo "Get your key at: https://tavily.com/"
            read -p "Tavily API Key (or press Enter to skip): " TAVILY_KEY
            if [ -n "$TAVILY_KEY" ]; then
                # Add to docker-compose.yml
                $SSH_CMD "bash -s" << ENDSSH
if ! grep -q "TAVILY_API_KEY" /root/openclaw/docker-compose.yml; then
    sed -i '/ANTHROPIC_API_KEY:/a\      TAVILY_API_KEY: $TAVILY_KEY' /root/openclaw/docker-compose.yml
    echo "Added TAVILY_API_KEY to docker-compose.yml"
fi
ENDSSH
                log_info "✓ Tavily API key configured"
            fi
            ;;
        "proactive-agent-1-2-4")
            log_info "✓ Proactive Agent installed with:"
            echo "    - Persistent memory system"
            echo "    - Self-healing capabilities"
            echo "    - Heartbeat monitoring"
            echo "    - Onboarding system"
            ;;
    esac
    echo ""
done

# Restart OpenClaw to apply changes
log_info "Restarting OpenClaw to apply skill configurations..."
$SSH_CMD "cd /root/openclaw && docker compose restart"

log_info "✓ All skills installed successfully!"
echo ""
echo "Installed Skills:"
for skill in "${SKILLS_TO_INSTALL[@]}"; do
    echo "  - $skill"
done
echo ""
echo "Discover more skills:"
echo "  Ask your OpenClaw: 'What skills are available for X?'"
echo "  Or visit: https://skills.sh/"
echo ""
echo "Test installed skills:"
echo "  ssh -p $SSH_PORT -i $SSH_KEY root@$SSH_HOST"
echo "  docker exec openclaw-openclaw-gateway-1 node dist/index.js agent --message 'search for latest AI news' --session-id test"
