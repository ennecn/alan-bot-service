# OpenClaw Troubleshooting Guide

This guide covers common issues encountered during OpenClaw deployment and operation.

## Table of Contents

1. [Connection Errors](#connection-errors)
2. [Channel Issues](#channel-issues)
3. [Browser Problems](#browser-problems)
4. [API Proxy Issues](#api-proxy-issues)
5. [Service Management](#service-management)
6. [Performance Issues](#performance-issues)

---

## Connection Errors

### Symptom: "Connection error" in AI responses

**Root Cause**: API proxy service has stopped running.

**Diagnosis**:
```bash
# Check if proxy is running
docker exec openclaw-openclaw-gateway-1 pgrep -f 'api-proxy.js'

# If no output, proxy is not running
```

**Fix**:
```bash
# Restart proxy service
systemctl restart openclaw-proxy

# Verify it's running
systemctl status openclaw-proxy

# Check logs
journalctl -u openclaw-proxy -f
```

**Prevention**: The systemd service should automatically restart, but if issues persist:
```bash
# Check service configuration
systemctl cat openclaw-proxy.service

# Ensure Restart=always is set
# Check RestartSec and StartLimitBurst settings
```

---

## Channel Issues

### Telegram: Bot Not Responding

**Symptom**: Bot appears online but doesn't respond to messages.

**Common Causes**:
1. Wrong field name in config (use `botToken`, not `token`)
2. Missing `allowFrom` when `dmPolicy` is `open`

**Fix**:
```bash
# Check configuration
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json

# Correct format:
{
  "telegram": {
    "enabled": true,
    "botToken": "YOUR_TOKEN",
    "dmPolicy": "open",
    "allowFrom": ["*"]
  }
}

# Validate configuration
docker exec openclaw-openclaw-gateway-1 node dist/index.js doctor --fix
```

### Discord: Bot Not Responding

**Symptom**: Bot shows online but ignores messages or @mentions.

**Root Cause**: Message Content Intent not enabled in Discord Developer Portal.

**Fix**:
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Navigate to **Bot** (left sidebar)
4. Scroll down to **Privileged Gateway Intents**
5. Enable: `MESSAGE CONTENT INTENT`
6. **Click Save Changes** (don't just toggle - must save!)
7. Restart OpenClaw:
   ```bash
   systemctl restart openclaw
   ```

**Common Mistake**: Settings on OAuth2 page don't affect intents. Must be on Bot page.

### Discord: "groupPolicy validation error"

**Fix**: Change `groupPolicy` to `open` in openclaw.json:
```json
{
  "discord": {
    "enabled": true,
    "groupPolicy": "open"
  }
}
```

---

## Browser Problems

### Browser Service Timeout

**Symptom**: "Can't reach the OpenClaw browser control service (timed out after 15000ms)"

**Root Cause**: Internal communication issue in OpenClaw browser service.

**Workaround**: This is expected behavior. OpenClaw automatically falls back to `web_fetch` tool.

**Not a Critical Issue**: Most web scraping and interaction works fine with web_fetch.

### Xvfb Not Starting

**Symptom**: "WARNING: Xvfb not running" in logs.

**Fix**:
```bash
# Check if Xvfb is running
docker exec openclaw-openclaw-gateway-1 pgrep -f 'Xvfb :99'

# Start manually if needed
docker exec -d -u root openclaw-openclaw-gateway-1 sh -c 'Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp > /tmp/xvfb.log 2>&1'

# Or run startup patch script
bash /root/openclaw/startup-patch.sh
```

### Chromium Not Found

**Symptom**: `chromium: command not found`

**Fix**: Run the browser setup script:
```bash
./scripts/setup-browser.sh --host YOUR_HOST --key YOUR_KEY
```

Or install manually:
```bash
docker exec -u root openclaw-openclaw-gateway-1 apt-get update
docker exec -u root openclaw-openclaw-gateway-1 apt-get install -y chromium chromium-sandbox xvfb
```

---

## API Proxy Issues

### Proxy Not Starting After Reboot

**Symptom**: OpenClaw works initially but fails after server restart.

**Fix**: Ensure systemd service is enabled:
```bash
systemctl enable openclaw-proxy
systemctl start openclaw-proxy
```

### Model Name Not Mapping

**Symptom**: API returns error about unknown model.

**Diagnosis**:
```bash
# Check proxy logs
docker exec openclaw-openclaw-gateway-1 cat /tmp/proxy.log

# Look for "Mapping model:" messages
```

**Fix**: Update model mapping in `/root/api-proxy.js`:
```javascript
const MODEL_MAP = {
  "claude-opus-4-5": "your-actual-model-name"
};
```

Then restart:
```bash
systemctl restart openclaw-proxy
```

### Patch Not Applied After Update

**Symptom**: OpenClaw tries to connect to api.anthropic.com directly.

**Fix**: Reapply patch manually:
```bash
bash /root/openclaw/startup-patch.sh
```

Or restart service (auto-applies patch):
```bash
systemctl restart openclaw
```

---

## Service Management

### Check All Services

```bash
# View status
systemctl status openclaw openclaw-proxy

# View logs
journalctl -u openclaw -f
journalctl -u openclaw-proxy -f
docker logs openclaw-openclaw-gateway-1 -f
```

### Service Won't Start

**Diagnosis**:
```bash
# Check Docker daemon
systemctl status docker

# Check for port conflicts
netstat -tuln | grep 18789
netstat -tuln | grep 8022

# Check disk space
df -h
```

**Fix**:
```bash
# Restart Docker
systemctl restart docker

# Clear old containers
docker system prune -a

# Check service configuration
systemctl cat openclaw.service
```

### OpenClaw Won't Stop

**Fix**:
```bash
# Force stop
docker stop openclaw-openclaw-gateway-1 -t 5

# Kill if needed
docker kill openclaw-openclaw-gateway-1

# Clean restart
docker compose down
docker compose up -d
```

---

## Performance Issues

### High Memory Usage

**Diagnosis**:
```bash
# Check container stats
docker stats openclaw-openclaw-gateway-1

# Check system memory
free -h
```

**Fix**: Add resource limits in docker-compose.yml:
```yaml
services:
  openclaw-gateway:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
```

### Slow Response Times

**Possible Causes**:
1. Network latency to custom API
2. Large workspace directory
3. Insufficient server resources

**Diagnosis**:
```bash
# Test API latency
time curl -X POST https://your-api.com/v1/messages \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-5","messages":[{"role":"user","content":"hi"}]}'

# Check workspace size
du -sh /root/openclaw/workspace

# Check server load
top
```

---

## Emergency Recovery

### Complete Reset

If all else fails:
```bash
# Stop everything
systemctl stop openclaw openclaw-proxy
docker compose down

# Backup data
tar -czf backup.tar.gz /root/openclaw/config /root/openclaw/workspace

# Remove containers
docker rm openclaw-openclaw-gateway-1

# Restart
systemctl start openclaw
```

### Restore from Backup

```bash
# Stop services
systemctl stop openclaw openclaw-proxy

# Extract backup
tar -xzf backup.tar.gz -C /root/openclaw/

# Restart
systemctl start openclaw openclaw-proxy
```

---

## Getting Help

If you're still experiencing issues:

1. **Check logs**: Most issues show clear error messages in logs
2. **Run doctor**: `docker exec openclaw-openclaw-gateway-1 node dist/index.js doctor`
3. **Check documentation**: https://docs.openclaw.ai
4. **Community support**: OpenClaw GitHub issues

## Diagnostic Commands Quick Reference

```bash
# Full health check
docker exec openclaw-openclaw-gateway-1 node dist/index.js doctor

# Service status
systemctl status openclaw openclaw-proxy

# Container status
docker ps -a | grep openclaw

# Network connectivity
curl http://127.0.0.1:8022/health
curl http://127.0.0.1:18789

# Check processes
docker exec openclaw-openclaw-gateway-1 ps aux

# View configurations
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json
cat /root/openclaw/docker-compose.yml
cat /root/api-proxy.js
```
