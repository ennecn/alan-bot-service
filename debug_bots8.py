#!/usr/bin/env python3
"""Find nodes configuration in OpenClaw containers."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=15)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# Search for node config files in each container
containers = {
    "阿凛": "deploy-openclaw-gateway-1",
    "阿澪": "aling-gateway",
    "Lain": "lain-gateway",
    "Lumi": "lumi-gateway"
}

for name, container in containers.items():
    print(f"\n{'='*50}")
    print(f"=== {name} ({container}) ===")
    print(f"{'='*50}")

    # Search for node-related config files
    result = run(f"{docker} exec {container} find /home/node/.openclaw -name '*node*' -not -path '*/node_modules/*' -not -path '*/workspace/*' 2>/dev/null")
    print(f"Node config files: {result.strip() if result.strip() else '(none)'}")

    # Check if there's a nodes section in openclaw.json
    result = run(f'{docker} exec {container} grep -A 20 "nodes" /home/node/.openclaw/openclaw.json 2>/dev/null | head -25')
    print(f"Nodes in config: {result.strip() if result.strip() else '(none)'}")

    # Check for any SSH/remote config
    result = run(f"{docker} exec {container} find /home/node/.openclaw -name '*.json' -not -path '*/node_modules/*' -not -path '*/workspace/*' 2>/dev/null")
    print(f"Config files: {result.strip()}")

    # Check the full openclaw.json for nodes
    result = run(f'{docker} exec {container} cat /home/node/.openclaw/openclaw.json 2>/dev/null | grep -i "node\\|ssh\\|remote\\|MacMini"')
    print(f"Node/SSH/Remote refs: {result.strip() if result.strip() else '(none)'}")

# Check the nodes-cli source for configuration hints
print(f"\n{'='*50}")
print("=== nodes-cli source (first 100 lines) ===")
print(f"{'='*50}")
result = run(f"{docker} exec deploy-openclaw-gateway-1 head -100 /app/dist/nodes-cli-hT8yYD7S.js 2>/dev/null")
print(result[:1000])

# Check node-service source
print(f"\n{'='*50}")
print("=== node-service source (search for config) ===")
print(f"{'='*50}")
result = run(f'{docker} exec deploy-openclaw-gateway-1 grep -i "config\\|ssh\\|MacMini\\|remote\\|host\\|port\\|password" /app/dist/node-service-Lc1LlnFH.js 2>/dev/null | head -20')
print(result[:1000] if result.strip() else "(none)")

# Check if nodes are stored in a database
print(f"\n{'='*50}")
print("=== SQLite databases ===")
print(f"{'='*50}")
result = run(f"{docker} exec deploy-openclaw-gateway-1 find /home/node/.openclaw -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' 2>/dev/null | head -10")
print(result if result.strip() else "(none)")

# Check the openclaw CLI help for nodes
print(f"\n{'='*50}")
print("=== openclaw nodes help ===")
print(f"{'='*50}")
result = run(f"{docker} exec deploy-openclaw-gateway-1 openclaw-gateway nodes --help 2>&1 | head -30")
print(result[:500])

c.close()
