---
name: openclaw-digital-ocean-deployment
description: Complete deployment automation for OpenClaw on Digital Ocean with custom API support, multi-channel configuration (Telegram, Discord), browser capabilities, and essential skills installation. Handles server provisioning, Docker setup, custom model proxying, and systemd service management.
---

# OpenClaw Digital Ocean Deployment

A comprehensive deployment skill for setting up production-ready OpenClaw instances on Digital Ocean VPS with custom Claude API integration, multiple messaging channels, and browser automation support.

## Features

✅ **Automated Server Setup**
- Digital Ocean VPS provisioning and configuration
- Docker and Docker Compose installation
- SSH key management and security hardening

✅ **Custom API Integration**
- API proxy for custom Claude endpoints (e.g., ai.t8star.cn)
- Model name mapping (claude-opus-4-5 → claude-opus-4-5-20251101-thinking)
- Runtime patching of hardcoded API URLs
- Systemd service for proxy stability

✅ **Multi-Channel Support**
- Telegram bot configuration
- Discord bot configuration
- Automatic connection verification

✅ **Browser Capabilities**
- Chromium installation in Docker container
- Xvfb virtual display server
- Automatic fallback to web_fetch when needed

✅ **Essential Skills**
- Tavily Search (AI-optimized search)
- Find Skills (skill discovery)
- Proactive Agent (autonomous AI architecture)

✅ **Production Ready**
- Systemd services for all components
- Automatic restart on failure
- Boot-time initialization
- Comprehensive logging

## Prerequisites

Before using this skill, you need:

1. **Digital Ocean Account**
   - API token with write permissions
   - Or manual VPS access via SSH

2. **API Credentials**
   - Custom Claude API endpoint URL
   - API key for your Claude provider
   - (Optional) Telegram bot token
   - (Optional) Discord bot token

3. **Local Machine**
   - SSH client
   - SSH key pair for server access

## Usage

### Quick Start (Interactive)

```bash
./scripts/deploy.sh
```

This will guide you through:
1. Server connection details
2. API configuration
3. Channel setup (Telegram, Discord)
4. Skills installation

### Automated Deployment

```bash
./scripts/deploy.sh \
  --host 138.68.44.141 \
  --port 2222 \
  --key ~/.ssh/id_ed25519 \
  --api-url https://ai.t8star.cn/v1/messages \
  --api-key sk-YOUR_KEY \
  --telegram-token YOUR_TELEGRAM_TOKEN \
  --discord-token YOUR_DISCORD_TOKEN
```

### Component-Specific Scripts

```bash
# Install API proxy only
./scripts/setup-api-proxy.sh

# Configure channels only
./scripts/setup-channels.sh

# Install browser support
./scripts/setup-browser.sh

# Install skills
./scripts/install-skills.sh
```

## Architecture

### API Proxy Layer

```
User Request → OpenClaw → API Proxy (127.0.0.1:8022) → Custom API → Claude
                ↓
         Model Mapping
    claude-opus-4-5 → claude-opus-4-5-20251101-thinking
```

**Why API Proxy?**
- OpenClaw uses `@mariozechner/pi-ai` library that hardcodes `https://api.anthropic.com`
- Environment variables like `ANTHROPIC_BASE_URL` are ignored
- Solution: Runtime patch + local proxy for transparent model mapping

### Systemd Services

1. **openclaw.service** - Main OpenClaw gateway
2. **openclaw-proxy.service** - API proxy (auto-restart on failure)
3. **cloudflare-tunnel.service** - Public access (optional)

### Directory Structure

```
/root/openclaw/
├── docker-compose.yml       # Container configuration
├── config/                  # OpenClaw configuration
│   └── openclaw.json
├── workspace/               # Agent workspace
├── startup-patch.sh         # Boot-time initialization
└── api-proxy.js            # Model mapping proxy
```

## Configuration

### OpenClaw Configuration

The skill automatically configures `openclaw.json` with:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TOKEN",
      "dmPolicy": "open",
      "allowFrom": ["*"]
    },
    "discord": {
      "enabled": true,
      "token": "YOUR_TOKEN",
      "groupPolicy": "open",
      "dm": {
        "policy": "open",
        "allowFrom": ["*"]
      }
    }
  },
  "browser": {
    "enabled": true,
    "defaultProfile": "openclaw"
  },
  "tools": {
    "web": {
      "search": {
        "apiKey": "YOUR_BRAVE_API_KEY"
      }
    }
  }
}
```

### Environment Variables

In `docker-compose.yml`:

```yaml
environment:
  HOME: /home/node
  TERM: xterm-256color
  OPENCLAW_GATEWAY_TOKEN: mysecrettoken123
  ANTHROPIC_BASE_URL: http://127.0.0.1:8022
  ANTHROPIC_API_KEY: sk-YOUR_KEY
  TAVILY_API_KEY: tvly-YOUR_KEY
  DISPLAY: :99
```

## Troubleshooting

### Common Issues

**1. Connection Error in AI Responses**

**Symptom**: Bot responds with "Connection error."

**Cause**: API proxy service stopped

**Fix**:
```bash
systemctl status openclaw-proxy
systemctl restart openclaw-proxy
```

**2. Discord Bot Not Responding**

**Symptom**: Bot online but doesn't reply to messages

**Cause**: Missing Message Content Intent

**Fix**:
1. Go to Discord Developer Portal
2. Bot → Privileged Gateway Intents
3. Enable "MESSAGE CONTENT INTENT"
4. Restart OpenClaw: `docker compose restart`

**3. Browser Timeout**

**Symptom**: "Browser service timed out"

**Cause**: Xvfb not running or Chromium not installed

**Fix**:
```bash
# Check if Chromium installed
docker exec openclaw-openclaw-gateway-1 which chromium

# Check if Xvfb running
docker exec openclaw-openclaw-gateway-1 pgrep -f Xvfb

# Restart startup script
bash /root/openclaw/startup-patch.sh
```

### Verification Commands

```bash
# Check all services
systemctl status openclaw openclaw-proxy

# Check OpenClaw health
docker exec openclaw-openclaw-gateway-1 node dist/index.js doctor

# Check API proxy
curl http://127.0.0.1:8022/health

# View logs
journalctl -u openclaw-proxy -f
docker logs openclaw-openclaw-gateway-1 -f
```

## Advanced Configuration

### Custom Model Mapping

Edit `/root/api-proxy.js` to add more model mappings:

```javascript
const MODEL_MAP = {
  "claude-opus-4-5": "claude-opus-4-5-20251101-thinking",
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  // Add your mappings here
};
```

### Additional Skills

Install more skills using ClawHub:

```bash
docker exec openclaw-openclaw-gateway-1 npx clawhub@latest install <skill-name>
```

Popular skills:
- `tavily-search` - AI-optimized search
- `find-skills` - Skill discovery
- `proactive-agent-1-2-4` - Autonomous agent architecture

### Multiple API Endpoints

To support multiple API providers, modify the proxy to route based on model name or add multiple proxy instances.

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
   ufw allow 2222/tcp  # SSH
   ufw allow 18789/tcp # Gateway (if needed)
   ufw enable
   ```

4. **Regular Updates**
   ```bash
   docker pull openclaw:local
   docker compose up -d
   ```

## Performance Tuning

### Container Resources

Edit `docker-compose.yml`:

```yaml
services:
  openclaw-gateway:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
```

### Proxy Performance

For high-traffic setups, consider:
- Using Nginx reverse proxy
- Load balancing multiple OpenClaw instances
- Redis for session storage

## Monitoring

### Service Health

```bash
# Create monitoring script
cat > /root/openclaw/monitor.sh << 'EOF'
#!/bin/bash
systemctl is-active openclaw || systemctl start openclaw
systemctl is-active openclaw-proxy || systemctl start openclaw-proxy
EOF

# Add to cron
crontab -e
*/5 * * * * /root/openclaw/monitor.sh
```

### Logging

All logs are available via:
- `journalctl -u openclaw-proxy`
- `docker logs openclaw-openclaw-gateway-1`
- `/tmp/openclaw/openclaw-*.log` (inside container)

## Cost Estimation

**Digital Ocean VPS** (2 vCPU, 4GB RAM):
- $24/month

**API Costs** (depends on usage):
- Custom Claude API: Variable
- Tavily API: Free tier available
- Brave Search: Free tier available

**Total**: ~$25-50/month for moderate usage

## Maintenance

### Regular Tasks

**Weekly**:
- Check disk space: `df -h`
- Review logs for errors
- Verify all services running

**Monthly**:
- Update OpenClaw: `cd /root/openclaw && git pull && docker compose build`
- Update system: `apt update && apt upgrade`
- Backup configuration: `tar -czf backup.tar.gz /root/openclaw/config`

### Backup

```bash
# Backup script
./scripts/backup.sh --output /path/to/backup.tar.gz
```

Includes:
- OpenClaw configuration
- API proxy configuration
- Systemd service files
- Workspace data

## Migration

To move to a new server:

1. Backup current instance
2. Deploy to new server with this skill
3. Restore configuration
4. Update DNS/tunnel if needed

## Contributing

Improvements welcome! Common enhancements:
- Support for more cloud providers (AWS, GCP, Azure)
- Additional channel integrations (WhatsApp, Slack)
- Advanced monitoring dashboards
- Automated backup solutions

## License

MIT License - feel free to modify and distribute

## Support

For issues or questions:
1. Check troubleshooting section
2. Review OpenClaw documentation: https://docs.openclaw.ai
3. Check deployment summary: `/root/openclaw/OpenClaw部署总结.md`

## Changelog

### v1.0.0 (2026-02-05)
- Initial release
- Digital Ocean deployment automation
- Custom API proxy with model mapping
- Telegram and Discord integration
- Browser support (Chromium + Xvfb)
- Systemd service management
- Essential skills installation (Tavily, Find Skills, Proactive Agent)
