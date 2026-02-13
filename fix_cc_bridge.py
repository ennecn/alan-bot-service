#!/usr/bin/env python3
"""Remove old cc-bridge skill from lain, lumi, aling bots."""
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

base = "/Users/fangjin/Desktop/p/docker-openclawd"
bots = ["deploy-lain", "deploy-lumi", "deploy-aling"]

for bot_dir in bots:
    skill_path = f"{base}/{bot_dir}/config/skills/cc-bridge"
    print(f"\n=== {bot_dir} ===")

    # Check what's in cc-bridge
    si, so, se = c.exec_command(f"ls -la {skill_path}/ 2>/dev/null")
    out = so.read().decode().strip()
    if out:
        print(f"  Found: {out}")
        # Remove the directory
        si, so, se = c.exec_command(f"rm -rf {skill_path}")
        so.read()
        se_out = se.read().decode().strip()
        if se_out:
            print(f"  Error: {se_out}")
        else:
            print(f"  Deleted cc-bridge skill")
    else:
        print(f"  cc-bridge not found (already clean)")

    # Verify claude-code skill exists
    si, so, se = c.exec_command(f"ls {base}/{bot_dir}/config/skills/claude-code/ 2>/dev/null")
    cc_files = so.read().decode().strip()
    print(f"  claude-code skill: {cc_files if cc_files else 'MISSING!'}")

# Verify all skills across all bots
print("\n\n=== Final skill inventory ===")
for bot_dir in ["deploy", "deploy-lain", "deploy-lumi", "deploy-aling"]:
    si, so, se = c.exec_command(f"ls {base}/{bot_dir}/config/skills/ 2>/dev/null")
    skills = so.read().decode().strip().replace('\n', ', ')
    print(f"  {bot_dir}: {skills}")

c.close()
print("\nDone!")
