#!/bin/bash
echo "[$(date)] Starting OpenClaw startup patch..."
sleep 5

# Patch models.generated.js to use local proxy
docker exec openclaw-openclaw-gateway-1 sed -i 's|https://api.anthropic.com|http://127.0.0.1:8022|g' \
  /app/node_modules/.pnpm/@mariozechner+pi-ai@*/node_modules/@mariozechner/pi-ai/dist/models.generated.js

echo "[$(date)] Patch applied successfully!"

# Ensure proxy service is running
if systemctl is-active --quiet openclaw-proxy.service; then
    echo "[$(date)] API Proxy service is running"
else
    echo "[$(date)] Starting API Proxy service..."
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
    echo "[$(date)] Starting Xvfb..."
    docker exec -d -u root openclaw-openclaw-gateway-1 sh -c 'Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp > /tmp/xvfb.log 2>&1'
fi

# Restart gateway
docker exec openclaw-openclaw-gateway-1 pkill -f 'openclaw-gateway' || true
sleep 2

echo "[$(date)] Startup configuration complete!"
