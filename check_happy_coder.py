#!/usr/bin/env python3
"""Check Happy Coder installation and configuration on Mac Mini."""
import subprocess
import sys

def ssh(cmd, label=""):
    if label:
        print(f"\n{'='*60}")
        print(f"  {label}")
        print(f"{'='*60}")
    result = subprocess.run(
        ['python', r'D:\openclawVPS\ssh_macmini.py', cmd],
        capture_output=True, text=True, timeout=30
    )
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(f"[stderr] {result.stderr.strip()}")
    if not result.stdout.strip() and not result.stderr.strip():
        print("(no output)")
    return result.stdout.strip()

commands = [
    ("which happy", "1. Which happy"),
    ("npm list -g happy-coder 2>&1", "2. npm global: happy-coder"),
    ("happy --version 2>&1", "3. happy --version"),
    ("find ~ -name '.happy*' -maxdepth 3 2>/dev/null", "4a. Find .happy* files"),
    ("find ~ -name 'happy*' -maxdepth 3 -type f 2>/dev/null | head -20", "4b. Find happy* files"),
    ("ps aux | grep -i happy | grep -v grep", "5. Processes matching 'happy'"),
    ("launchctl list 2>/dev/null | grep -i happy", "6. launchd services matching 'happy'"),
    ("cat ~/.happy/config.json 2>/dev/null || cat ~/.happyrc 2>/dev/null || echo 'no config found'", "7. Happy config"),
    ("lsof -i -P 2>/dev/null | grep -i happy | head -10", "8. Happy network listeners"),
    ("npm list -g --depth=0 2>/dev/null", "9. All global npm packages"),
]

print("Checking Happy Coder on Mac Mini (192.168.21.111)...")
for cmd, label in commands:
    ssh(cmd, label)

print(f"\n{'='*60}")
print("  Done.")
print(f"{'='*60}")
