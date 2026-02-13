#!/usr/bin/env python3
"""Install claude-mem plugin on Mac Mini's Claude Code.
Steps:
1. Install bun via homebrew
2. Clone thedotmack/claude-mem repo
3. Run bun install
4. Set up plugin config files
5. Start worker service
"""
import paramiko
import json
import time

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

def run(cmd, timeout=60):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode().strip()
    err = se.read().decode().strip()
    return out, err

def run_print(cmd, label="", timeout=60):
    out, err = run(cmd, timeout)
    if label:
        print(f"   {label}: {out[:200] if out else '(empty)'}")
    if err and "warning" not in err.lower():
        print(f"   stderr: {err[:200]}")
    return out, err

# ============================================================
# 1. Install bun
# ============================================================
print("1. Checking/installing bun...")
out, _ = run("which bun 2>/dev/null || echo 'not found'")
if "not found" in out:
    print("   Installing bun via homebrew...")
    out, err = run("/opt/homebrew/bin/brew install oven-sh/bun/bun", timeout=120)
    print(f"   {out[-200:] if out else err[-200:]}")
    out, _ = run("which bun; bun --version")
    print(f"   Installed: {out}")
else:
    ver, _ = run("bun --version")
    print(f"   bun already installed: {ver}")

# ============================================================
# 2. Clone claude-mem repo
# ============================================================
MARKETPLACE_DIR = "/Users/fangjin/.claude/plugins/marketplaces/thedotmack"
print(f"\n2. Setting up claude-mem repo...")

out, _ = run(f"test -d {MARKETPLACE_DIR} && echo 'exists' || echo 'missing'")
if out == "exists":
    print("   Marketplace dir exists, pulling latest...")
    out, err = run(f"cd {MARKETPLACE_DIR} && git pull", timeout=60)
    print(f"   {out[:200]}")
else:
    print("   Cloning thedotmack/claude-mem...")
    run("mkdir -p /Users/fangjin/.claude/plugins/marketplaces")
    out, err = run(
        f"git clone https://github.com/thedotmack/claude-mem.git {MARKETPLACE_DIR}",
        timeout=120
    )
    print(f"   {out[:200] if out else 'clone complete'}")
    if err:
        print(f"   stderr: {err[:200]}")

# Get version
ver_out, _ = run(f"grep '\"version\"' {MARKETPLACE_DIR}/package.json | head -1")
print(f"   Version: {ver_out.strip()}")

# ============================================================
# 3. Install dependencies
# ============================================================
print("\n3. Installing dependencies with bun...")
out, err = run(f"cd {MARKETPLACE_DIR} && bun install", timeout=120)
# Show last few lines
lines = out.split("\n") if out else []
for line in lines[-5:]:
    if line.strip():
        print(f"   {line}")
if err:
    err_lines = err.split("\n")
    for line in err_lines[-3:]:
        if line.strip():
            print(f"   stderr: {line}")

# ============================================================
# 4. Set up plugin cache directory
# ============================================================
print("\n4. Setting up plugin cache...")
# Extract version number
import re
ver_match = re.search(r'"version"\s*:\s*"([^"]+)"', ver_out)
version = ver_match.group(1) if ver_match else "9.1.1"

CACHE_DIR = f"/Users/fangjin/.claude/plugins/cache/thedotmack/claude-mem/{version}"
run(f"mkdir -p {CACHE_DIR}")

# Copy plugin directory to cache
out, err = run(f"cp -r {MARKETPLACE_DIR}/plugin/* {CACHE_DIR}/")
print(f"   Copied plugin files to cache ({version})")

# Get git commit sha
sha, _ = run(f"cd {MARKETPLACE_DIR} && git rev-parse HEAD")
print(f"   Git SHA: {sha[:12]}")

# ============================================================
# 5. Update config files
# ============================================================
print("\n5. Updating plugin config files...")

# Update known_marketplaces.json
km_path = "/Users/fangjin/.claude/plugins/known_marketplaces.json"
km_out, _ = run(f"cat {km_path}")
try:
    km = json.loads(km_out)
except:
    km = {}

km["thedotmack"] = {
    "source": {
        "source": "github",
        "repo": "thedotmack/claude-mem"
    },
    "installLocation": MARKETPLACE_DIR,
    "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
}

sftp = c.open_sftp()
with sftp.open(km_path, "wb") as f:
    f.write(json.dumps(km, indent=2).encode("utf-8"))
print("   Updated known_marketplaces.json")

# Update installed_plugins.json
ip_path = "/Users/fangjin/.claude/plugins/installed_plugins.json"
ip_out, _ = run(f"cat {ip_path}")
try:
    ip = json.loads(ip_out)
except:
    ip = {"version": 2, "plugins": {}}

now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
ip["plugins"]["claude-mem@thedotmack"] = [{
    "scope": "user",
    "installPath": CACHE_DIR,
    "version": version,
    "installedAt": now,
    "lastUpdated": now,
    "gitCommitSha": sha
}]

with sftp.open(ip_path, "wb") as f:
    f.write(json.dumps(ip, indent=2).encode("utf-8"))
sftp.close()
print("   Updated installed_plugins.json")

# ============================================================
# 6. Create settings.json
# ============================================================
print("\n6. Creating claude-mem settings...")
run("mkdir -p /Users/fangjin/.claude-mem")

settings = {
    "CLAUDE_MEM_MODEL": "claude-sonnet-4-5",
    "CLAUDE_MEM_CONTEXT_OBSERVATIONS": "50",
    "CLAUDE_MEM_WORKER_PORT": "37777",
    "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
    "CLAUDE_MEM_SKIP_TOOLS": "ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",
    "CLAUDE_MEM_PROVIDER": "claude",
    "CLAUDE_MEM_CLAUDE_AUTH_METHOD": "cli",
    "CLAUDE_MEM_DATA_DIR": "/Users/fangjin/.claude-mem",
    "CLAUDE_MEM_LOG_LEVEL": "INFO",
    "CLAUDE_MEM_MODE": "code",
    "CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS": "true",
    "CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS": "true",
    "CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT": "true",
    "CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT": "true",
    "CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES": "bugfix,feature,refactor,discovery,decision,change",
    "CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS": "how-it-works,why-it-exists,what-changed,problem-solution,gotcha,pattern,trade-off",
    "CLAUDE_MEM_CONTEXT_FULL_COUNT": "5",
    "CLAUDE_MEM_CONTEXT_FULL_FIELD": "narrative",
    "CLAUDE_MEM_CONTEXT_SESSION_COUNT": "10",
    "CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY": "true",
    "CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE": "false",
    "CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED": "false",
    "CLAUDE_MEM_EXCLUDED_PROJECTS": "",
    "CLAUDE_MEM_FOLDER_MD_EXCLUDE": "[]"
}

sftp = c.open_sftp()
with sftp.open("/Users/fangjin/.claude-mem/settings.json", "wb") as f:
    f.write(json.dumps(settings, indent=2).encode("utf-8"))
sftp.close()
print("   Created ~/.claude-mem/settings.json")

# ============================================================
# 7. Start worker
# ============================================================
print("\n7. Starting worker service...")
out, err = run(
    f"cd {MARKETPLACE_DIR} && bun plugin/scripts/worker-service.cjs restart",
    timeout=30
)
print(f"   {out if out else '(started)'}")
if err:
    print(f"   stderr: {err[:200]}")

time.sleep(2)

out, err = run(f"cd {MARKETPLACE_DIR} && bun plugin/scripts/worker-service.cjs status")
print(f"   Status: {out}")

# ============================================================
# 8. Verify
# ============================================================
print("\n8. Verification...")
run_print(f"cat {ip_path} | python3 -c \"import sys,json; d=json.load(sys.stdin); print(list(d['plugins'].keys()))\"", "Plugins")
run_print(f"ls {CACHE_DIR}/ | head -10", "Cache files")
run_print("curl -s http://127.0.0.1:37777/api/health 2>/dev/null || echo 'worker not responding'", "Worker health")

c.close()
print("\nDone! claude-mem installed on Mac Mini.")
print(f"Version: {version}")
print("Worker should be running on port 37777")
print("Next Claude Code session will auto-load the plugin")
