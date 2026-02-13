#!/usr/bin/env python3
"""Install dev-browser plugin on Windows (local) and Mac Mini.
dev-browser is a Claude Code plugin for browser automation via Playwright.
"""
import subprocess
import json
import os
import time

# ============================================================
# Part 1: Install on Windows (local)
# ============================================================
print("=" * 60)
print("Part 1: Installing dev-browser on Windows")
print("=" * 60)

HOME = os.path.expanduser("~")
PLUGINS_DIR = os.path.join(HOME, ".claude", "plugins")
MARKETPLACE_DIR = os.path.join(PLUGINS_DIR, "marketplaces", "sawyerhood")
SKILL_DIR = os.path.join(MARKETPLACE_DIR, "skills", "dev-browser")

# 1. Clone repo
print("\n1. Setting up repo...")
if os.path.exists(MARKETPLACE_DIR):
    print("   Marketplace dir exists, pulling latest...")
    r = subprocess.run(["git", "pull"], cwd=MARKETPLACE_DIR, capture_output=True, text=True)
    print(f"   {r.stdout.strip()}")
else:
    print("   Cloning sawyerhood/dev-browser...")
    os.makedirs(os.path.dirname(MARKETPLACE_DIR), exist_ok=True)
    r = subprocess.run(
        ["git", "clone", "https://github.com/SawyerHood/dev-browser.git", MARKETPLACE_DIR],
        capture_output=True, text=True
    )
    print(f"   {r.stderr.strip() if r.stderr else 'done'}")

# 2. Install skill dependencies
print("\n2. Installing skill dependencies...")
r = subprocess.run(["npm", "install"], cwd=SKILL_DIR, capture_output=True, text=True, shell=True)
lines = (r.stdout or r.stderr or "").strip().split("\n")
for line in lines[-5:]:
    if line.strip():
        print(f"   {line}")

# 3. Install Playwright browsers
print("\n3. Installing Playwright browsers...")
r = subprocess.run(
    ["npx", "playwright", "install", "chromium"],
    cwd=SKILL_DIR, capture_output=True, text=True, shell=True, timeout=300
)
lines = (r.stdout or r.stderr or "").strip().split("\n")
for line in lines[-5:]:
    if line.strip():
        print(f"   {line}")

# 4. Get version and git sha
with open(os.path.join(MARKETPLACE_DIR, ".claude-plugin", "marketplace.json")) as f:
    mkt = json.load(f)
version = mkt.get("metadata", {}).get("version", "1.0.0")

r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=MARKETPLACE_DIR, capture_output=True, text=True)
sha = r.stdout.strip()
print(f"\n4. Version: {version}, SHA: {sha[:12]}")

# 5. Set up cache directory
CACHE_DIR = os.path.join(PLUGINS_DIR, "cache", "sawyerhood", "dev-browser", version)
os.makedirs(CACHE_DIR, exist_ok=True)

# Copy skill files to cache (the skill IS the plugin content)
import shutil
skill_cache = os.path.join(CACHE_DIR, "skills", "dev-browser")
if os.path.exists(skill_cache):
    shutil.rmtree(skill_cache)
os.makedirs(os.path.dirname(skill_cache), exist_ok=True)
shutil.copytree(SKILL_DIR, skill_cache)

# Copy root-level plugin files
for f in ["CLAUDE.md", "README.md", "LICENSE"]:
    src = os.path.join(MARKETPLACE_DIR, f)
    if os.path.exists(src):
        shutil.copy2(src, CACHE_DIR)

# Copy .claude-plugin dir
cp_dir = os.path.join(MARKETPLACE_DIR, ".claude-plugin")
dst_cp = os.path.join(CACHE_DIR, ".claude-plugin")
if os.path.exists(dst_cp):
    shutil.rmtree(dst_cp)
if os.path.exists(cp_dir):
    shutil.copytree(cp_dir, dst_cp)

print(f"   Cache: {CACHE_DIR}")

# 6. Update config files
print("\n5. Updating plugin config...")

# known_marketplaces.json
km_path = os.path.join(PLUGINS_DIR, "known_marketplaces.json")
with open(km_path) as f:
    km = json.load(f)

km["sawyerhood"] = {
    "source": {"source": "github", "repo": "SawyerHood/dev-browser"},
    "installLocation": MARKETPLACE_DIR,
    "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
}
with open(km_path, "w") as f:
    json.dump(km, f, indent=2)
print("   Updated known_marketplaces.json")

# installed_plugins.json
ip_path = os.path.join(PLUGINS_DIR, "installed_plugins.json")
with open(ip_path) as f:
    ip = json.load(f)

now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
ip["plugins"]["dev-browser@sawyerhood"] = [{
    "scope": "user",
    "installPath": CACHE_DIR,
    "version": version,
    "installedAt": now,
    "lastUpdated": now,
    "gitCommitSha": sha
}]
with open(ip_path, "w") as f:
    json.dump(ip, f, indent=2)
print("   Updated installed_plugins.json")

print(f"\n   Windows installation complete! (v{version})")

# ============================================================
# Part 2: Install on Mac Mini
# ============================================================
print("\n" + "=" * 60)
print("Part 2: Installing dev-browser on Mac Mini")
print("=" * 60)

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

def run(cmd, timeout=120):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode().strip(), se.read().decode().strip()

MM_PLUGINS = "/Users/fangjin/.claude/plugins"
MM_MDIR = f"{MM_PLUGINS}/marketplaces/sawyerhood"
MM_SKILL = f"{MM_MDIR}/skills/dev-browser"

# 1. Clone repo
print("\n1. Setting up repo on Mac Mini...")
out, _ = run(f"test -d {MM_MDIR} && echo exists || echo missing")
if out == "exists":
    print("   Pulling latest...")
    out, err = run(f"cd {MM_MDIR} && git pull", timeout=60)
    print(f"   {out}")
else:
    print("   Cloning...")
    run(f"mkdir -p {MM_PLUGINS}/marketplaces")
    out, err = run(f"git clone https://github.com/SawyerHood/dev-browser.git {MM_MDIR}", timeout=120)
    print(f"   {err[:100] if err else 'done'}")

# 2. Install skill dependencies
print("\n2. Installing skill dependencies...")
out, err = run(f"cd {MM_SKILL} && npm install", timeout=120)
lines = (out or err).split("\n")
for line in lines[-5:]:
    if line.strip():
        print(f"   {line}")

# 3. Install Playwright browsers
print("\n3. Installing Playwright chromium...")
out, err = run(f"cd {MM_SKILL} && npx playwright install chromium", timeout=300)
lines = (out or err).split("\n")
for line in lines[-5:]:
    if line.strip():
        print(f"   {line}")

# 4. Get version and sha
out, _ = run(f"python3 -c \"import json; print(json.load(open('{MM_MDIR}/.claude-plugin/marketplace.json'))['metadata']['version'])\"")
mm_version = out.strip() or "1.0.0"
sha_out, _ = run(f"cd {MM_MDIR} && git rev-parse HEAD")
mm_sha = sha_out.strip()
print(f"\n4. Version: {mm_version}, SHA: {mm_sha[:12]}")

# 5. Set up cache
MM_CACHE = f"{MM_PLUGINS}/cache/sawyerhood/dev-browser/{mm_version}"
run(f"mkdir -p {MM_CACHE}/skills")
run(f"rm -rf {MM_CACHE}/skills/dev-browser")
run(f"cp -r {MM_SKILL} {MM_CACHE}/skills/dev-browser")
for f in ["CLAUDE.md", "README.md", "LICENSE"]:
    run(f"cp {MM_MDIR}/{f} {MM_CACHE}/ 2>/dev/null")
run(f"cp -r {MM_MDIR}/.claude-plugin {MM_CACHE}/.claude-plugin 2>/dev/null")
print(f"   Cache: {MM_CACHE}")

# 6. Update config files
print("\n5. Updating plugin config...")

km_out, _ = run(f"cat {MM_PLUGINS}/known_marketplaces.json")
try:
    mm_km = json.loads(km_out)
except:
    mm_km = {}

mm_km["sawyerhood"] = {
    "source": {"source": "github", "repo": "SawyerHood/dev-browser"},
    "installLocation": MM_MDIR,
    "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
}

sftp = c.open_sftp()
with sftp.open(f"{MM_PLUGINS}/known_marketplaces.json", "wb") as f:
    f.write(json.dumps(mm_km, indent=2).encode("utf-8"))

ip_out, _ = run(f"cat {MM_PLUGINS}/installed_plugins.json")
try:
    mm_ip = json.loads(ip_out)
except:
    mm_ip = {"version": 2, "plugins": {}}

mm_ip["plugins"]["dev-browser@sawyerhood"] = [{
    "scope": "user",
    "installPath": MM_CACHE,
    "version": mm_version,
    "installedAt": now,
    "lastUpdated": now,
    "gitCommitSha": mm_sha
}]

with sftp.open(f"{MM_PLUGINS}/installed_plugins.json", "wb") as f:
    f.write(json.dumps(mm_ip, indent=2).encode("utf-8"))
sftp.close()
print("   Updated config files")

# 7. Verify
print("\n6. Verification...")
out, _ = run(f"ls {MM_CACHE}/skills/dev-browser/ | head -10")
print(f"   Cache files: {out}")
out, _ = run(f"cat {MM_PLUGINS}/installed_plugins.json | python3 -c \"import sys,json; print(list(json.load(sys.stdin)['plugins'].keys()))\"")
print(f"   Installed plugins: {out}")
out, _ = run(f"test -f {MM_SKILL}/node_modules/.package-lock.json && echo 'npm OK' || echo 'npm missing'")
print(f"   Dependencies: {out}")

c.close()

print("\n" + "=" * 60)
print("Installation complete!")
print("=" * 60)
print(f"Windows: v{version} at {MARKETPLACE_DIR}")
print(f"Mac Mini: v{mm_version} at {MM_MDIR}")
print("Restart Claude Code to activate the plugin.")
