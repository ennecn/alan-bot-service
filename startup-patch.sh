#!/bin/bash
# OpenClaw startup patch script
# Patches hardcoded API URLs and verifies Antigravity Manager reachability

echo "[$(date)] Starting OpenClaw startup patch..."

# Wait for container to be fully up
sleep 5

# Backup current proxy before deploying new one
cp /root/api-proxy.js /root/api-proxy.js.bak 2>/dev/null

# Check Antigravity Manager reachability
if curl -sf http://127.0.0.1:8045/health > /dev/null 2>&1; then
  echo "[$(date)] Antigravity Manager is reachable on port 8045"
else
  echo "[$(date)] WARNING: Antigravity Manager not reachable on port 8045 - T8 fallback will be used"
fi

# Find the models.generated.js file
MODEL_FILE=$(docker exec openclaw-openclaw-gateway-1 find /app -name "models.generated.js" 2>/dev/null | head -1)

if [ -z "$MODEL_FILE" ]; then
  echo "[$(date)] Error: models.generated.js not found"
  exit 1
fi

echo "[$(date)] Found model file: $MODEL_FILE"

# Check if already patched
ANTHROPIC_COUNT=$(docker exec openclaw-openclaw-gateway-1 grep -c 'api.anthropic.com' "$MODEL_FILE")
if [ "$ANTHROPIC_COUNT" -gt 0 ]; then
  echo "[$(date)] Patching $ANTHROPIC_COUNT occurrences of api.anthropic.com..."
  docker exec openclaw-openclaw-gateway-1 sed -i \
    -e 's|baseUrl: "https://api.anthropic.com"|baseUrl: "http://127.0.0.1:8022"|g' \
    -e 's|baseUrl: "https://openrouter.ai/api/v1"|baseUrl: "http://127.0.0.1:8022"|g' \
    -e 's|baseUrl: "https://ai-gateway.vercel.sh"|baseUrl: "http://127.0.0.1:8022"|g' \
    "$MODEL_FILE"
  echo "[$(date)] Patch applied. Restarting container to load patched file..."
  docker restart openclaw-openclaw-gateway-1
  sleep 8
else
  echo "[$(date)] File already patched, no restart needed."
fi

echo "[$(date)] Startup patch complete."
