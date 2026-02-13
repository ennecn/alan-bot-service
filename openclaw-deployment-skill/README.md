# OpenClaw Digital Ocean Deployment Skill

A comprehensive deployment automation skill for setting up production-ready OpenClaw instances on Digital Ocean VPS with custom Claude API integration, multi-channel support, and browser capabilities.

## Quick Start

### Prerequisites

- Digital Ocean VPS (or any Ubuntu/Debian server)
- SSH access with key-based authentication
- Custom Claude API endpoint and key

### One-Command Deployment

```bash
cd openclaw-deployment-skill
chmod +x scripts/*.sh

./scripts/deploy.sh \
  --host YOUR_SERVER_IP \
  --port 2222 \
  --key ~/.ssh/id_ed25519 \
  --api-url https://your-api.com/v1/messages \
  --api-key sk-YOUR_KEY
```

This will:
1. ✅ Install Docker and dependencies
2. ✅ Clone and build OpenClaw
3. ✅ Configure API proxy with model mapping
4. ✅ Set up systemd services
5. ✅ Create auto-start scripts
6. ✅ Start OpenClaw gateway

### Post-Deployment

Configure channels (optional):
```bash
./scripts/setup-channels.sh \
  --host YOUR_SERVER_IP \
  --telegram-token YOUR_TELEGRAM_TOKEN \
  --discord-token YOUR_DISCORD_TOKEN
```

Install browser support (optional):
```bash
./scripts/setup-browser.sh --host YOUR_SERVER_IP
```

Install essential skills (recommended):
```bash
./scripts/install-skills.sh --host YOUR_SERVER_IP --all
```

## Directory Structure

```
openclaw-deployment-skill/
├── SKILL.md                    # Comprehensive documentation
├── README.md                   # This file
├── scripts/                    # Deployment scripts
│   ├── deploy.sh              # Main deployment script
│   ├── setup-api-proxy.sh     # API proxy configuration
│   ├── setup-channels.sh      # Telegram/Discord setup
│   ├── setup-browser.sh       # Browser automation setup
│   ├── install-skills.sh      # Skills installation
│   └── backup.sh              # Configuration backup
├── templates/                  # Configuration templates
│   ├── docker-compose.yml     # Container configuration
│   ├── openclaw.json          # OpenClaw settings
│   ├── api-proxy.js           # Proxy script
│   ├── startup-patch.sh       # Boot initialization
│   ├── openclaw.service       # Main systemd service
│   └── openclaw-proxy.service # Proxy systemd service
└── references/                 # Technical documentation
    ├── ARCHITECTURE.md        # System design and decisions
    └── TROUBLESHOOTING.md     # Common issues and fixes
```

## Features

✅ **Automated Server Setup**
- Docker and Docker Compose installation
- SSH key management
- Security configuration

✅ **Custom API Integration**
- API proxy for custom Claude endpoints
- Model name mapping (claude-opus-4-5 → claude-opus-4-5-20251101-thinking)
- Runtime patching of hardcoded API URLs
- Systemd service for stability

✅ **Multi-Channel Support**
- Telegram bot configuration
- Discord bot configuration with intents guide
- Automatic connection verification

✅ **Browser Capabilities**
- Chromium installation
- Xvfb virtual display server
- Automatic fallback to web_fetch

✅ **Essential Skills**
- Tavily Search (AI-optimized search)
- Find Skills (skill discovery)
- Proactive Agent (autonomous AI architecture)

✅ **Production Ready**
- Systemd services with auto-restart
- Boot-time initialization
- Comprehensive logging
- Backup and restore scripts

## Usage Examples

### Interactive Deployment

```bash
./scripts/deploy.sh
# Follow the prompts
```

### Component-Specific Setup

```bash
# Install only API proxy
./scripts/setup-api-proxy.sh \
  --host 1.2.3.4 \
  --api-url https://api.example.com \
  --api-key sk-KEY

# Configure only channels
./scripts/setup-channels.sh \
  --host 1.2.3.4 \
  --telegram-token 123:ABC \
  --discord-token MTQ2...

# Install only browser
./scripts/setup-browser.sh --host 1.2.3.4

# Install specific skills
./scripts/install-skills.sh \
  --host 1.2.3.4 \
  --skill tavily-search \
  --skill find-skills
```

### Backup and Restore

```bash
# Create backup
./scripts/backup.sh \
  --host 1.2.3.4 \
  --output backup-$(date +%Y%m%d).tar.gz \
  --include-workspace

# Restore (on new server after running deploy.sh)
tar -xzf backup.tar.gz
# Copy files to /root/openclaw/ on server
# Restart: systemctl restart openclaw openclaw-proxy
```

## Architecture Overview

```
User Request → OpenClaw Gateway → API Proxy → Custom API → Claude
                   ↓
            Model Mapping
       claude-opus-4-5 → claude-opus-4-5-20251101-thinking
```

### Key Components

1. **OpenClaw Gateway**: Main application (Node.js in Docker)
2. **API Proxy**: Local proxy for model mapping (127.0.0.1:8022)
3. **Runtime Patch**: Automatic URL patching in node_modules
4. **Systemd Services**: Auto-restart and boot initialization
5. **Browser Stack**: Chromium + Xvfb for web automation

See [references/ARCHITECTURE.md](references/ARCHITECTURE.md) for detailed technical documentation.

## Common Issues

### Connection Error in AI Responses

**Problem**: Bot responds with "Connection error."

**Fix**:
```bash
ssh root@YOUR_HOST 'systemctl restart openclaw-proxy'
```

### Discord Bot Not Responding

**Problem**: Bot online but ignores messages.

**Fix**: Enable MESSAGE CONTENT INTENT in Discord Developer Portal → Bot page.

### Browser Timeout

**Problem**: "Browser service timed out"

**Status**: Expected behavior. OpenClaw automatically falls back to web_fetch.

See [references/TROUBLESHOOTING.md](references/TROUBLESHOOTING.md) for comprehensive troubleshooting guide.

## Server Requirements

### Minimum

- **CPU**: 2 vCPU
- **RAM**: 4GB
- **Storage**: 20GB
- **OS**: Ubuntu 20.04+ or Debian 11+

### Recommended

- **CPU**: 4 vCPU
- **RAM**: 8GB
- **Storage**: 40GB SSD
- **Network**: Stable connection, low latency to API endpoint

### Cost Estimate

- **Digital Ocean VPS** (2 vCPU, 4GB RAM): $24/month
- **API Costs**: Variable based on usage
- **Total**: ~$25-50/month

## Security Best Practices

1. **Change Default Gateway Token**
   ```yaml
   OPENCLAW_GATEWAY_TOKEN: <generate-random-token>
   ```

2. **Restrict Channel Access**
   ```json
   "allowFrom": ["specific_user_id"]
   ```

3. **Enable Firewall**
   ```bash
   ufw allow 2222/tcp
   ufw allow 18789/tcp  # Only if needed
   ufw enable
   ```

4. **Regular Updates**
   ```bash
   cd /root/openclaw && git pull
   docker compose build && docker compose up -d
   ```

## Verification Commands

```bash
# Check services
ssh root@HOST 'systemctl status openclaw openclaw-proxy'

# View logs
ssh root@HOST 'docker logs openclaw-openclaw-gateway-1 -f'

# Test AI
ssh root@HOST 'docker exec openclaw-openclaw-gateway-1 node dist/index.js agent --message "hello" --session-id test'

# Check proxy
ssh root@HOST 'journalctl -u openclaw-proxy -f'
```

## Customization

### Model Mapping

Edit `templates/api-proxy.js`:
```javascript
const MODEL_MAP = {
  "claude-opus-4-5": "your-actual-model-name",
  "claude-sonnet-4": "your-sonnet-model"
};
```

### Additional Skills

Browse skills at: https://skills.sh/

Install with:
```bash
./scripts/install-skills.sh --host HOST --skill SKILL_NAME
```

### Multiple API Endpoints

Modify proxy to route based on model name or deploy multiple proxy instances.

## Maintenance

### Regular Tasks

**Weekly**:
- Check logs for errors
- Verify services running
- Monitor disk space

**Monthly**:
- Update OpenClaw: `git pull && docker compose build`
- Update system: `apt update && apt upgrade`
- Backup configuration: `./scripts/backup.sh`

## Documentation

- **[SKILL.md](SKILL.md)**: Complete feature documentation and usage guide
- **[ARCHITECTURE.md](references/ARCHITECTURE.md)**: Technical design and decisions
- **[TROUBLESHOOTING.md](references/TROUBLESHOOTING.md)**: Common issues and fixes
- **[OpenClaw Docs](https://docs.openclaw.ai)**: Official documentation

## License

MIT License - feel free to modify and distribute.

## Support

For issues or questions:
1. Check [TROUBLESHOOTING.md](references/TROUBLESHOOTING.md)
2. Review [ARCHITECTURE.md](references/ARCHITECTURE.md)
3. Check OpenClaw documentation
4. Open GitHub issue

## Credits

Created based on real-world deployment experience with:
- Digital Ocean VPS
- Custom Claude API integration (ai.t8star.cn)
- Multi-channel bot configuration
- Production stability improvements

## Changelog

### v1.0.0 (2026-02-06)
- Initial release
- Complete deployment automation
- Custom API proxy with model mapping
- Multi-channel support (Telegram, Discord)
- Browser capabilities (Chromium + Xvfb)
- Systemd service management
- Essential skills installation
- Comprehensive documentation
