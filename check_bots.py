#!/usr/bin/env python3
"""Compare openclaw.json between all 4 bots - full content."""
import paramiko
import json

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

base = "/Users/fangjin/Desktop/p/docker-openclawd"
bots = {
    "alin": "deploy",
    "lain": "deploy-lain",
    "lumi": "deploy-lumi",
    "aling": "deploy-aling",
}

configs = {}
for name, dir_name in bots.items():
    si, so, se = c.exec_command(f"cat {base}/{dir_name}/config/openclaw.json")
    raw = so.read().decode()
    try:
        configs[name] = json.loads(raw)
    except:
        configs[name] = None
        print(f"ERROR parsing {name}: {raw[:200]}")

# Compare key sections
for name, cfg in configs.items():
    if not cfg:
        continue
    print(f"\n{'='*60}")
    print(f"=== {name} ===")
    print(f"{'='*60}")

    # Model
    model = cfg.get("agents", {}).get("defaults", {}).get("model", {})
    print(f"  model.primary: {model.get('primary', '?')}")
    print(f"  model.fallback: {model.get('fallback', '?')}")

    # Compaction
    compaction = cfg.get("agents", {}).get("defaults", {}).get("compaction", {})
    print(f"  compaction: {json.dumps(compaction) if compaction else 'not set'}")

    # Context pruning
    pruning = cfg.get("agents", {}).get("defaults", {}).get("contextPruning", {})
    print(f"  contextPruning: {json.dumps(pruning) if pruning else 'not set'}")

    # Tools - exec
    tools = cfg.get("tools", {})
    print(f"  tools.exec: {json.dumps(tools.get('exec', {}))}")

    # Providers
    providers = cfg.get("models", {}).get("providers", {})
    for pname, pcfg in providers.items():
        print(f"  provider.{pname}: api={pcfg.get('api','?')} baseUrl={pcfg.get('baseUrl','?')}")

    # Skills
    si2, so2, se2 = c.exec_command(f"ls {base}/{dir_name}/config/skills/ 2>/dev/null")
    skills = so2.read().decode().strip()
    print(f"  skills: {skills}")

    # Check for any extra keys not in the template
    all_keys = set()
    def collect_keys(d, prefix=""):
        for k, v in d.items():
            full = f"{prefix}.{k}" if prefix else k
            all_keys.add(full)
            if isinstance(v, dict):
                collect_keys(v, full)
    collect_keys(cfg)
    print(f"  total config keys: {len(all_keys)}")

# Now do a full diff between alin and lain
print(f"\n\n{'='*60}")
print("=== FULL DIFF: alin vs lain openclaw.json ===")
print(f"{'='*60}")
si, so, se = c.exec_command(f"diff {base}/deploy/config/openclaw.json {base}/deploy-lain/config/openclaw.json")
diff = so.read().decode()
print(diff if diff else "IDENTICAL")

print(f"\n{'='*60}")
print("=== FULL DIFF: alin vs lumi openclaw.json ===")
print(f"{'='*60}")
si, so, se = c.exec_command(f"diff {base}/deploy/config/openclaw.json {base}/deploy-lumi/config/openclaw.json")
diff = so.read().decode()
print(diff if diff else "IDENTICAL")

print(f"\n{'='*60}")
print("=== FULL DIFF: alin vs aling openclaw.json ===")
print(f"{'='*60}")
si, so, se = c.exec_command(f"diff {base}/deploy/config/openclaw.json {base}/deploy-aling/config/openclaw.json")
diff = so.read().decode()
print(diff if diff else "IDENTICAL")

c.close()
