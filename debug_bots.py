#!/usr/bin/env python3
"""Check bot logs and nodes config for debugging."""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd)
    out = so.read().decode('utf-8', errors='replace')
    err = se.read().decode('utf-8', errors='replace')
    return out + err

# Check container logs for each bot
for bot, container in [("阿澪", "aling-gateway"), ("Lain", "lain-gateway"), ("Lumi", "lumi-gateway"), ("阿凛", "deploy-openclaw-gateway-1")]:
    print(f"\n{'='*60}")
    print(f"=== {bot} ({container}) ===")
    print(f"{'='*60}")

    # Recent logs with errors
    print("\n--- Recent error logs ---")
    result = run(f"docker logs {container} --tail 100 2>&1 | grep -i -E 'error|fail|nodes|validation|claude.code|dispatch' | tail -20")
    print(result if result.strip() else "(no matching logs)")

    # Check nodes config in openclaw.json
    deploy_dir = {
        "aling-gateway": "deploy-aling",
        "lain-gateway": "deploy-lain",
        "lumi-gateway": "deploy-lumi",
        "deploy-openclaw-gateway-1": "deploy"
    }[container]

    print("--- nodes config in openclaw.json ---")
    result = run(f"grep -A 20 'nodes' ~/Desktop/p/docker-openclawd/{deploy_dir}/config/openclaw.json 2>&1 | head -30")
    print(result if result.strip() else "(no 'nodes' section found)")

# Check the SKILL.md for claude-code to understand how it dispatches
print(f"\n{'='*60}")
print("=== Claude Code SKILL.md (阿凛) ===")
print(f"{'='*60}")
result = run("cat ~/Desktop/p/docker-openclawd/deploy/config/skills/claude-code/SKILL.md")
print(result)

c.close()
