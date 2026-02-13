#!/usr/bin/env python3
"""Apply compaction settings to all 4 OpenClaw bots."""
import paramiko
import json

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
BASE = '/Users/fangjin/Desktop/p/docker-openclawd'

BOTS = [
    {"name": "阿澪", "dir": "deploy-aling", "container": "aling-gateway"},
    {"name": "Lain", "dir": "deploy-lain", "container": "lain-gateway"},
    {"name": "Lumi", "dir": "deploy-lumi", "container": "lumi-gateway"},
]

COMPACTION = {
    "mode": "safeguard",
    "maxHistoryShare": 0.2
}

CONTEXT_PRUNING = {
    "mode": "cache-ttl",
    "ttl": "15m",
    "minPrunableToolChars": 5000
}

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)
sftp = client.open_sftp()

for bot in BOTS:
    config_path = f"{BASE}/{bot['dir']}/config/openclaw.json"
    print(f"\n--- {bot['name']} ({bot['dir']}) ---")

    try:
        with sftp.open(config_path, 'r') as f:
            config = json.load(f)
    except Exception as e:
        print(f"  ERROR reading config: {e}")
        continue

    # Ensure agents.defaults exists
    if 'agents' not in config:
        config['agents'] = {}
    if 'defaults' not in config['agents']:
        config['agents']['defaults'] = {}

    defaults = config['agents']['defaults']
    old_compaction = defaults.get('compaction', 'not set')
    old_pruning = defaults.get('contextPruning', 'not set')

    defaults['compaction'] = COMPACTION
    defaults['contextPruning'] = CONTEXT_PRUNING

    print(f"  compaction: {old_compaction} -> {COMPACTION}")
    print(f"  contextPruning: {old_pruning} -> {CONTEXT_PRUNING}")

    with sftp.open(config_path, 'w') as f:
        f.write(json.dumps(config, indent=2))
    print(f"  Config updated!")

sftp.close()

# Restart all 3 containers
print("\n--- Restarting containers ---")
for bot in BOTS:
    dir_path = f"{BASE}/{bot['dir']}"
    print(f"  Restarting {bot['name']} ({bot['container']})...")
    _, stdout, stderr = client.exec_command(
        f"export PATH=/usr/local/bin:/usr/bin:/bin && cd {dir_path} && docker compose restart"
    )
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if 'Started' in err:
        print(f"  OK!")
    else:
        print(f"  OUT: {out}")
        print(f"  ERR: {err}")

client.close()
print("\nAll done!")
