#!/usr/bin/env python3
import paramiko
import sys
import time

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd)
    try:
        exit_status = stdout.channel.recv_exit_status()
    except:
        exit_status = -1
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if out: print(out)
    if err: print(err, file=sys.stderr)
    return exit_status

# 1. Create docker-compose.yml for Lain
lain_compose = r"""
services:
  lain-gateway:
    image: openclaw:local
    container_name: lain-gateway
    ports:
      - "18790:18789"
      - "8023:8022"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: ${GATEWAY_TOKEN:-mysecrettoken123}
      OPENCLAW_GATEWAY_PASSWORD: openclaw123
      ANTHROPIC_BASE_URL: http://127.0.0.1:8022
      ANTHROPIC_API_KEY: sk-dummy-key-for-lain
      DISPLAY: :99
    volumes:
      - ./config:/home/node/.openclaw
      - ./workspace:/home/node/.openclaw/workspace
      - ./api-proxy.js:/home/node/api-proxy.js:ro
      - ./start.sh:/home/node/start.sh:ro
      - ./anthropic.js:/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js:ro
      - /tmp/nas:/mnt/nas
    init: true
    restart: unless-stopped
    entrypoint: ["bash", "/home/node/start.sh"]
"""

print("Creating lain compose file...")
cmd_create_lain = f"cat > /Users/fangjin/Desktop/p/docker-openclawd/deploy-lain/docker-compose.yml << 'EOF'\n{lain_compose}\nEOF"
run_cmd(cmd_create_lain)


# 2. Patch script for others (adding extra_hosts)
patch_js = r"""
const fs = require('fs');
const path = require('path');

const deployPath = process.argv[2];
if (!deployPath) process.exit(1);

const composePath = path.join(deployPath, 'docker-compose.yml');
if (fs.existsSync(composePath)) {
    console.log('Patching ' + composePath);
    let content = fs.readFileSync(composePath, 'utf8');
    
    if (!content.includes('extra_hosts:')) {
        const envMatch = content.match(/(\s+)environment:/);
        if (envMatch) {
            const indent = envMatch[1];
            const insert = `\n${indent}extra_hosts:\n${indent}  - "host.docker.internal:host-gateway"`;
            content = content.replace(envMatch[0], insert + '\n' + envMatch[0]);
            fs.writeFileSync(composePath, content);
            console.log('Added extra_hosts');
        } else if (content.match(/(\s+)image:/)) {
            const imgMatch = content.match(/(\s+)image:/);
            const indent = imgMatch[1];
            const insert = `\n${indent}extra_hosts:\n${indent}  - "host.docker.internal:host-gateway"`;
            content = content.replace(imgMatch[0], imgMatch[0] + insert);
            fs.writeFileSync(composePath, content);
            console.log('Added extra_hosts after image');
        }
    } else {
        console.log('extra_hosts already present');
    }
}
"""

print("Creating patch script...")
run_cmd(f"cat > /tmp/patch_compose.js << 'EOF'\n{patch_js}\nEOF")

deployments = [
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy',
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lumi',
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling' # Just to be sure
]

for d in deployments:
    print(f"Patching {d}...")
    run_cmd(f"/Users/fangjin/local/bin/node /tmp/patch_compose.js \"{d}\"")

# 3. Restart All
all_deployments = deployments + ['/Users/fangjin/Desktop/p/docker-openclawd/deploy-lain']

for d in all_deployments:
    print(f"\nUpping {d}...")
    # Clean up any existing containers if they were started manually (for lain)
    if 'deploy-lain' in d:
        run_cmd(f"PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker stop lain-gateway")
        run_cmd(f"PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker rm lain-gateway")

    # Use 'docker compose'
    cmd = f"cd {d} && PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker compose up -d"
    run_cmd(cmd)
    time.sleep(2)

print("\nAll bots updated with proper networking.")
