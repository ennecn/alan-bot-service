#!/bin/bash
# OpenClaw Backup Script
# Creates a complete backup of OpenClaw configuration and data

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
OUTPUT_FILE="openclaw-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
INCLUDE_WORKSPACE=false

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
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --include-workspace)
            INCLUDE_WORKSPACE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host                SSH host IP address"
            echo "  --port                SSH port (default: 22)"
            echo "  --key                 Path to SSH private key"
            echo "  --output              Output backup file (default: openclaw-backup-TIMESTAMP.tar.gz)"
            echo "  --include-workspace   Include workspace directory (may be large)"
            echo "  --help                Show this help message"
            echo ""
            echo "What gets backed up:"
            echo "  ✓ OpenClaw configuration (openclaw.json)"
            echo "  ✓ API proxy configuration (api-proxy.js)"
            echo "  ✓ Docker Compose configuration"
            echo "  ✓ Systemd service files"
            echo "  ✓ Startup scripts"
            echo "  ✓ Credentials"
            echo "  ✗ Workspace (use --include-workspace to include)"
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

log_info "Creating OpenClaw backup..."
echo "  Host: $SSH_HOST:$SSH_PORT"
echo "  Output: $OUTPUT_FILE"
if [ "$INCLUDE_WORKSPACE" = true ]; then
    echo "  Workspace: Included"
fi
echo ""

# Create temporary directory on server
TEMP_DIR="/tmp/openclaw-backup-$$"
$SSH_CMD "mkdir -p $TEMP_DIR"

# Step 1: Backup OpenClaw configuration
log_info "Step 1/6: Backing up OpenClaw configuration..."
$SSH_CMD "mkdir -p $TEMP_DIR/config && cp -r /root/openclaw/config/* $TEMP_DIR/config/ 2>/dev/null || true"

# Step 2: Backup API proxy
log_info "Step 2/6: Backing up API proxy configuration..."
$SSH_CMD "cp /root/api-proxy.js $TEMP_DIR/api-proxy.js 2>/dev/null || true"

# Step 3: Backup Docker Compose
log_info "Step 3/6: Backing up Docker Compose configuration..."
$SSH_CMD "cp /root/openclaw/docker-compose.yml $TEMP_DIR/docker-compose.yml 2>/dev/null || true"

# Step 4: Backup systemd services
log_info "Step 4/6: Backing up systemd services..."
$SSH_CMD "mkdir -p $TEMP_DIR/systemd"
$SSH_CMD "cp /etc/systemd/system/openclaw.service $TEMP_DIR/systemd/ 2>/dev/null || true"
$SSH_CMD "cp /etc/systemd/system/openclaw-proxy.service $TEMP_DIR/systemd/ 2>/dev/null || true"
$SSH_CMD "cp /etc/systemd/system/cloudflare-tunnel.service $TEMP_DIR/systemd/ 2>/dev/null || true"

# Step 5: Backup startup scripts
log_info "Step 5/6: Backing up startup scripts..."
$SSH_CMD "cp /root/openclaw/startup-patch.sh $TEMP_DIR/startup-patch.sh 2>/dev/null || true"

# Step 6: Optionally backup workspace
if [ "$INCLUDE_WORKSPACE" = true ]; then
    log_info "Step 6/6: Backing up workspace (this may take a while)..."
    $SSH_CMD "cp -r /root/openclaw/workspace $TEMP_DIR/ 2>/dev/null || true"
else
    log_info "Step 6/6: Skipping workspace backup (use --include-workspace to include)"
fi

# Create backup metadata
log_info "Creating backup metadata..."
$SSH_CMD "cat > $TEMP_DIR/BACKUP_INFO.txt" << EOF
OpenClaw Backup
Created: $(date)
Host: $SSH_HOST
Backup includes:
  - OpenClaw configuration (openclaw.json)
  - API proxy configuration (api-proxy.js)
  - Docker Compose configuration
  - Systemd service files
  - Startup scripts
  - Credentials
$([ "$INCLUDE_WORKSPACE" = true ] && echo "  - Workspace data" || echo "  - Workspace data (not included)")

Restore instructions:
1. Deploy fresh OpenClaw instance using deploy.sh
2. Stop OpenClaw: systemctl stop openclaw openclaw-proxy
3. Extract backup to /root/openclaw/
4. Restart services: systemctl start openclaw openclaw-proxy
EOF

# Create tarball
log_info "Compressing backup..."
$SSH_CMD "cd /tmp && tar -czf /tmp/backup.tar.gz openclaw-backup-$$/"

# Download backup
log_info "Downloading backup..."
scp -P $SSH_PORT -i "$SSH_KEY" root@$SSH_HOST:/tmp/backup.tar.gz "$OUTPUT_FILE"

# Cleanup
log_info "Cleaning up temporary files..."
$SSH_CMD "rm -rf $TEMP_DIR /tmp/backup.tar.gz"

# Get backup size
BACKUP_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

log_info "✓ Backup completed successfully!"
echo ""
echo "Backup Details:"
echo "  File: $OUTPUT_FILE"
echo "  Size: $BACKUP_SIZE"
echo ""
echo "To restore:"
echo "  1. Deploy fresh instance: ./scripts/deploy.sh"
echo "  2. Extract: tar -xzf $OUTPUT_FILE"
echo "  3. Copy files to /root/openclaw/ on server"
echo "  4. Restart: systemctl restart openclaw openclaw-proxy"
echo ""
log_warn "Remember to backup regularly!"
