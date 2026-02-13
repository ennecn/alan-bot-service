# OpenClaw Architecture Reference

This document explains the technical architecture and design decisions behind the OpenClaw Digital Ocean deployment.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Digital Ocean VPS                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │         OpenClaw Docker Container                  │ │
│  │  ┌──────────────────────────────────────────────┐  │ │
│  │  │      OpenClaw Gateway (Node.js)              │  │ │
│  │  │  - Telegram Bot                              │  │ │
│  │  │  - Discord Bot                               │  │ │
│  │  │  - Web Gateway                               │  │ │
│  │  └──────────────────────────────────────────────┘  │ │
│  │                       ↓                             │ │
│  │  ┌──────────────────────────────────────────────┐  │ │
│  │  │  API Proxy (Node.js on 127.0.0.1:8022)      │  │ │
│  │  │  - Model name mapping                        │  │ │
│  │  │  - Request forwarding                        │  │ │
│  │  └──────────────────────────────────────────────┘  │ │
│  │                       ↓                             │ │
│  │  ┌──────────────────────────────────────────────┐  │ │
│  │  │  Browser Stack                               │  │ │
│  │  │  - Chromium                                  │  │ │
│  │  │  - Xvfb (Virtual Display :99)                │  │ │
│  │  └──────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
│                       ↓                                  │
│  ┌────────────────────────────────────────────────────┐ │
│  │           Systemd Service Manager                  │ │
│  │  - openclaw.service                               │ │
│  │  - openclaw-proxy.service                         │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                        ↓
         ┌──────────────────────────┐
         │   Custom Claude API      │
         │  (ai.t8star.cn)          │
         └──────────────────────────┘
```

## Core Components

### 1. OpenClaw Gateway

**Purpose**: Main application server handling all user interactions.

**Technology**: Node.js application running inside Docker container

**Responsibilities**:
- Manage WebSocket connections
- Handle Telegram/Discord bot integrations
- Process AI requests
- Manage agent sessions
- Execute tools and skills

**Configuration**:
- Location: `/root/openclaw/config/openclaw.json`
- Port: 18789 (configurable)
- Network: Host mode (direct access to host network)

**Key Features**:
- Multi-channel support (Telegram, Discord, Web)
- Skill system via ClawHub
- Browser automation capabilities
- Session management with memory

### 2. API Proxy Layer

**Purpose**: Intercept and transform API requests to support custom Claude endpoints.

**Why Needed?**:
- OpenClaw uses `@mariozechner/pi-ai` library
- Library hardcodes `https://api.anthropic.com` in source
- `ANTHROPIC_BASE_URL` environment variable is ignored
- Direct modification would require forking the library

**Solution**: Runtime patching + local proxy

**Implementation**:
```javascript
// Listens on 127.0.0.1:8022
// Transforms: claude-opus-4-5 → claude-opus-4-5-20251101-thinking
// Forwards to: https://ai.t8star.cn/v1/messages
```

**Request Flow**:
```
OpenClaw Request
  ↓ (hardcoded URL patched to http://127.0.0.1:8022)
API Proxy
  ↓ (model name mapped)
Custom Claude API
  ↓ (response)
API Proxy
  ↓ (unchanged)
OpenClaw
```

**Management**:
- Runs as systemd service
- Auto-restart on failure (RestartSec=5)
- Logs to journald

### 3. Runtime Patching System

**Problem**: The `@mariozechner/pi-ai` library has hardcoded API URLs in compiled JavaScript.

**Location**:
```
/app/node_modules/.pnpm/@mariozechner+pi-ai@*/
  node_modules/@mariozechner/pi-ai/dist/models.generated.js
```

**Patch Method**:
```bash
sed -i 's|https://api.anthropic.com|http://127.0.0.1:8022|g' models.generated.js
```

**Execution**:
- Applied by `startup-patch.sh` script
- Triggered by `ExecStartPost` in systemd service
- Runs after container starts
- Idempotent (safe to run multiple times)

**Why This Works**:
- Node modules are in Docker volume
- Patch survives container restarts
- No need to rebuild Docker image
- Transparent to application code

### 4. Browser Stack

**Components**:
- **Chromium**: Headless browser for web automation
- **Xvfb**: Virtual X11 display server (display :99)
- **Resolution**: 1920x1080x24

**Purpose**:
- Web scraping
- Form automation
- Screenshot capture
- Dynamic content rendering

**Installation**: Dynamic (via startup-patch.sh)
- Checks if Chromium installed
- Installs if missing
- Starts Xvfb if not running

**Limitations**:
- OpenClaw browser control service has timeout issues
- AI automatically falls back to `web_fetch` tool
- web_fetch sufficient for most use cases

### 5. Systemd Service Management

**Services**:

1. **openclaw.service**
   - Type: Forking
   - Manages: Docker Compose lifecycle
   - Runs: startup-patch.sh after start
   - Auto-restart: On failure

2. **openclaw-proxy.service**
   - Type: Simple
   - Manages: API proxy process
   - Runs: Inside Docker container
   - Auto-restart: Always (with backoff)

**Benefits**:
- Automatic startup on boot
- Crash recovery
- Centralized logging (journald)
- Service dependencies

**Startup Sequence**:
```
1. Docker service starts
2. openclaw.service starts
   → docker compose up -d
   → Container starts
   → startup-patch.sh runs
      → Patches models.generated.js
      → Checks/starts proxy service
      → Installs Chromium if needed
      → Starts Xvfb
3. openclaw-proxy.service starts
   → Copies api-proxy.js to container
   → Starts proxy inside container
```

## Network Architecture

### Port Mapping

| Port | Service | Access |
|------|---------|--------|
| 18789 | OpenClaw Gateway | LAN |
| 8022 | API Proxy | Localhost only |
| 2222 | SSH (custom) | Public |

### Network Mode: Host

**Chosen**: `network_mode: host`

**Reasons**:
- Simplifies proxy access (localhost always works)
- No port mapping complexity
- Better performance (no NAT overhead)
- Easier service communication

**Trade-off**: Less network isolation, but acceptable for single-application VPS

## Data Storage

### Persistent Volumes

```yaml
volumes:
  - ./config:/home/node/.openclaw          # Configuration
  - ./workspace:/home/node/.openclaw/workspace  # Agent workspace
```

### Important Paths

| Path | Content | Backup? |
|------|---------|---------|
| `/root/openclaw/config/` | Bot tokens, API keys, settings | ✅ Critical |
| `/root/openclaw/workspace/` | Agent memory, files | ✅ Important |
| `/root/openclaw/docker-compose.yml` | Container config | ✅ Critical |
| `/root/api-proxy.js` | Proxy configuration | ✅ Critical |
| `/etc/systemd/system/openclaw*.service` | Service definitions | ✅ Critical |
| `/root/openclaw/startup-patch.sh` | Initialization script | ✅ Critical |

## Security Considerations

### 1. API Keys

**Storage**:
- Environment variables in docker-compose.yml
- JSON configuration in openclaw.json

**Protection**:
- File permissions (root only)
- Not exposed in logs
- Container isolation

### 2. Gateway Token

**Purpose**: Authenticate Web Gateway access

**Default**: `mysecrettoken123` (should be changed)

**Usage**: `http://host:18789/?token=YOUR_TOKEN`

**Recommendation**: Generate random token:
```bash
openssl rand -hex 32
```

### 3. Channel Access Control

**Telegram**:
```json
{
  "dmPolicy": "open",
  "allowFrom": ["*"]  // Change to specific user IDs in production
}
```

**Discord**:
```json
{
  "groupPolicy": "open",
  "dm": {
    "policy": "open",
    "allowFrom": ["*"]
  }
}
```

**Recommendation**: Restrict to specific users:
```json
"allowFrom": ["123456789", "987654321"]
```

### 4. Firewall

**Recommended Rules**:
```bash
ufw allow 2222/tcp   # SSH (custom port)
ufw allow 18789/tcp  # Gateway (if public access needed)
ufw enable
```

## Performance Optimization

### 1. Resource Limits

Add to docker-compose.yml:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
```

### 2. Docker Image Size

**Current**: ~6.18GB

**Why Large**:
- Full Node.js environment
- Chromium browser
- Development tools

**Optimization**: Use dynamic installation instead of rebuilding image

### 3. Proxy Performance

**Current**: Single-threaded Node.js proxy

**For High Load**:
- Deploy multiple proxy instances
- Use Nginx load balancer
- Implement connection pooling

## Deployment Patterns

### 1. Initial Deployment

```
deploy.sh
  ├── Server provisioning
  ├── Docker installation
  ├── OpenClaw build
  ├── Proxy setup
  ├── Service creation
  └── Configuration
```

### 2. Updates

```bash
# Update OpenClaw
cd /root/openclaw
git pull
docker compose build
docker compose up -d

# Patch automatically reapplied by startup-patch.sh
```

### 3. Backup

```
backup.sh
  ├── Configuration files
  ├── Credentials
  ├── Workspace (optional)
  └── Service definitions
```

### 4. Migration

```
1. Backup old server
2. Deploy to new server
3. Restore configuration
4. Update DNS/channels
```

## Design Decisions

### Why Runtime Patching?

**Alternatives Considered**:
1. ❌ Fork pi-ai library → Maintenance burden
2. ❌ Modify OpenClaw source → Complex, breaks updates
3. ✅ Runtime patch + proxy → Simple, maintainable

**Trade-offs**:
- ✅ No source modifications needed
- ✅ Easy to update OpenClaw
- ✅ Transparent to application
- ⚠️ Patch must be reapplied after updates
- ⚠️ Extra layer (minimal overhead)

### Why Systemd Over Docker Restart Policy?

**Systemd**:
- ✅ Better control over startup sequence
- ✅ Can run external scripts (startup-patch.sh)
- ✅ Centralized logging
- ✅ Service dependencies

**Docker restart policy**:
- ❌ Can't run ExecStartPost scripts
- ❌ Less control over initialization
- ✅ Simpler for basic use cases

### Why Dynamic Installation?

**Dynamic (chosen)**:
- ✅ No image rebuild needed
- ✅ Faster updates
- ✅ Survives container restarts
- ⚠️ Slightly slower first start

**Baked into image**:
- ✅ Faster startup
- ❌ 6GB+ image to rebuild
- ❌ SSH timeout issues during build
- ❌ Harder to customize

## Monitoring and Observability

### Logs

**Gateway Logs**:
```bash
docker logs openclaw-openclaw-gateway-1 -f
```

**Proxy Logs**:
```bash
journalctl -u openclaw-proxy -f
docker exec openclaw-openclaw-gateway-1 cat /tmp/proxy.log
```

**System Logs**:
```bash
journalctl -u openclaw -f
```

### Health Checks

```bash
# OpenClaw doctor
docker exec openclaw-openclaw-gateway-1 node dist/index.js doctor

# Proxy health
curl http://127.0.0.1:8022/health

# Service status
systemctl status openclaw openclaw-proxy
```

### Metrics

**Key Indicators**:
- Service uptime
- Memory usage
- Response times
- Error rates
- API call counts

**Monitoring Script** (cron job):
```bash
#!/bin/bash
systemctl is-active openclaw || systemctl start openclaw
systemctl is-active openclaw-proxy || systemctl start openclaw-proxy
```

## Future Enhancements

### Potential Improvements

1. **Load Balancing**
   - Multiple OpenClaw instances
   - Nginx reverse proxy
   - Redis session storage

2. **Monitoring**
   - Prometheus metrics
   - Grafana dashboards
   - Alert system

3. **Security**
   - Let's Encrypt SSL
   - Rate limiting
   - IP whitelisting

4. **High Availability**
   - Database backend
   - Shared storage
   - Multi-region deployment

5. **CI/CD**
   - Automated deployment
   - Configuration management
   - Rollback capabilities
