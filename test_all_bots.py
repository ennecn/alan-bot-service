#!/usr/bin/env python3
"""Test all 4 bots by resetting sessions and sending test messages via Telegram DM.

Strategy:
1. Reset sessions on all 4 bots (delete session files)
2. Send a test message via Telegram Bot API to the user's DM
3. Wait for the bot to process and check the session transcript
"""
import paramiko
import sys
import json
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=15)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

def run_long(cmd, timeout=60):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# Bot configs
bots = {
    "阿凛": {"container": "deploy-openclaw-gateway-1", "port": "18789"},
    "阿澪": {"container": "aling-gateway", "port": "18791"},
    "Lain": {"container": "lain-gateway", "port": "18790"},
    "Lumi": {"container": "lumi-gateway", "port": "18792"},
}

# Step 1: Reset sessions on all 4 bots
print("=" * 60)
print("  Step 1: Reset sessions")
print("=" * 60)

for name, cfg in bots.items():
    container = cfg['container']
    # Delete all session files
    r = run(f'{docker} exec {container} sh -c "rm -f /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null && echo OK"')
    # Also clear sessions.json entries
    r2 = run(f'{docker} exec {container} sh -c "echo \'[]\' > /home/node/.openclaw/agents/main/sessions/sessions.json 2>/dev/null && echo OK"')
    print(f"  {name}: sessions cleared ({r.strip()}, {r2.strip()})")

# Step 2: Send test message via wake (triggers bot to process)
print()
print("=" * 60)
print("  Step 2: Send test messages via wake")
print("=" * 60)

test_msg = "帮我写一个计算1+2+3的python脚本"

for name, cfg in bots.items():
    port = cfg['port']
    # Use inject.js with wake method
    cmd = f'/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "{test_msg}" wake 0 3 {port}'
    r = run(cmd)
    print(f"  {name} (:{port}): {r.strip()}")

# Step 3: Wait for processing
print()
print("Waiting 30s for bots to process...")
time.sleep(30)

# Step 4: Check session transcripts
print()
print("=" * 60)
print("  Step 3: Check results")
print("=" * 60)

for name, cfg in bots.items():
    container = cfg['container']
    print(f"\n--- {name} ---")

    # Find latest session
    r = run(f'{docker} exec {container} sh -c "ls -t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -1"')
    latest = r.strip()
    if not latest:
        print("  No session found!")
        continue

    # Check for nodes tool calls
    r = run(f'{docker} exec {container} sh -c "grep nodes {latest} 2>/dev/null"')
    if r.strip():
        for line in r.strip().split('\n'):
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                role = msg.get('role', '?')
                if role == 'assistant':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'toolCall' and item.get('name') == 'nodes':
                            args = item.get('arguments', {})
                            cmd_val = args.get('command', '')
                            is_array = isinstance(cmd_val, list)
                            print(f"  nodes call: command is {'ARRAY ✓' if is_array else 'STRING ✗'}")
                            if is_array:
                                print(f"    command: {cmd_val[:200]}")
                            else:
                                print(f"    command: {str(cmd_val)[:200]}")
                elif role == 'toolResult':
                    tool_name = msg.get('toolName', '')
                    if tool_name == 'nodes':
                        content = msg.get('content', [])
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                text = item['text'][:300]
                                if 'Validation' in text:
                                    print(f"  VALIDATION ERROR: {text}")
                                elif 'success' in text or 'dispatched' in text:
                                    print(f"  SUCCESS: {text[:200]}")
                                else:
                                    print(f"  Result: {text[:200]}")
            except:
                pass
    else:
        # Check what happened - maybe still processing or no nodes call
        r = run(f'{docker} exec {container} sh -c "wc -l {latest} 2>/dev/null"')
        print(f"  Session lines: {r.strip()}")
        r = run(f'{docker} exec {container} sh -c "tail -3 {latest} 2>/dev/null"')
        for line in r.strip().split('\n')[-2:]:
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                role = msg.get('role', '?')
                if role == 'assistant':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            print(f"  Last msg: {item['text'][:200]}")
                        elif isinstance(item, dict) and item.get('type') == 'toolCall':
                            print(f"  Tool call: {item.get('name')}({json.dumps(item.get('arguments',{}))[:200]})")
            except:
                pass

c.close()
