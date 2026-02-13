#!/usr/bin/env python3
"""Test all 4 bots by injecting messages via chat.inject.

The inject creates/resumes a session and the bot processes the message.
"""
import paramiko
import sys
import json
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=30)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

bots = {
    "阿凛": {"container": "deploy-openclaw-gateway-1", "port": "18789"},
    "阿澪": {"container": "aling-gateway", "port": "18791"},
    "Lain": {"container": "lain-gateway", "port": "18790"},
    "Lumi": {"container": "lumi-gateway", "port": "18792"},
}

# DM session key for user 6564284621
SESSION_KEY = "agent:main:telegram:dm:6564284621"
TEST_MSG = "[Telegram Jehuty Ariadne (@serena_233) id:6564284621 2026-02-11 12:55 UTC] 帮我写一个计算1+2+3的python脚本\n[message_id: 9999]"

print("=" * 60)
print("  Injecting test messages")
print("=" * 60)

for name, cfg in bots.items():
    port = cfg['port']
    # Use chat.inject with the DM session key
    escaped_msg = TEST_MSG.replace('"', '\\"').replace('\n', '\\n')
    cmd = f'/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "{escaped_msg}" "{SESSION_KEY}" 0 3 {port}'
    r = run(cmd)
    print(f"  {name} (:{port}): {r.strip()}")

print()
print("Waiting 40s for bots to process...")
time.sleep(40)

print()
print("=" * 60)
print("  Checking results")
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

    r = run(f'{docker} exec {container} sh -c "wc -l {latest} 2>/dev/null"')
    print(f"  Session: {latest.split('/')[-1]} ({r.strip().split()[0]} lines)")

    # Check for nodes tool calls
    r = run(f'{docker} exec {container} sh -c "grep nodes {latest} 2>/dev/null"')
    if r.strip():
        found_nodes = False
        for line in r.strip().split('\n'):
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                role = msg.get('role', '?')
                if role == 'assistant':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'toolCall' and item.get('name') == 'nodes':
                            found_nodes = True
                            args = item.get('arguments', {})
                            cmd_val = args.get('command', '')
                            is_array = isinstance(cmd_val, list)
                            has_action = 'action' in args
                            print(f"  nodes call: command={'ARRAY ✓' if is_array else 'STRING ✗'}, action={'present' if has_action else 'missing'}")
                            if is_array:
                                print(f"    {cmd_val}")
                            else:
                                print(f"    {str(cmd_val)[:300]}")
                elif role == 'toolResult' and msg.get('toolName') == 'nodes':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            text = item['text']
                            if 'Validation' in text:
                                print(f"  ✗ VALIDATION ERROR: {text[:300]}")
                            elif 'success' in text or 'dispatched' in text:
                                print(f"  ✓ SUCCESS: dispatched")
                            else:
                                print(f"  Result: {text[:200]}")
            except:
                pass
        if not found_nodes:
            print("  (nodes mentioned but no tool call found)")
    else:
        # No nodes calls - check what happened
        r = run(f'{docker} exec {container} sh -c "tail -3 {latest} 2>/dev/null"')
        for line in r.strip().split('\n'):
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                role = msg.get('role', '?')
                ts = obj.get('timestamp', '')
                if role == 'assistant':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            print(f"  [{ts}] {item['text'][:200]}")
                        elif isinstance(item, dict) and item.get('type') == 'toolCall':
                            print(f"  [{ts}] Tool: {item.get('name')}({json.dumps(item.get('arguments',{}))[:200]})")
            except:
                pass

c.close()
