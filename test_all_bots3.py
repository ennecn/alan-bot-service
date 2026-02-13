#!/usr/bin/env python3
"""Test all 4 bots by sending Telegram messages to the group chat.

Uses the relay bot to send messages mentioning each OpenClaw bot.
The bots should respond to mentions and use the claude-code skill.
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

# Relay bot config
RELAY_TOKEN = "7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"
GROUP_CHAT_ID = "-1003849405283"
TG_PROXY_IP = "138.68.44.141"

bots = {
    "阿凛": {"container": "deploy-openclaw-gateway-1", "port": "18789", "username": "windclaw_bot", "num": 6},
    "阿澪": {"container": "aling-gateway", "port": "18791", "username": "thunderopenclaw_bot", "num": 7},
    "Lain": {"container": "lain-gateway", "port": "18790", "username": "TorrentClaw_bot", "num": 8},
    "Lumi": {"container": "lumi-gateway", "port": "18792", "username": "StarlightClaw_bot", "num": 9},
}

# Send test messages to group chat mentioning each bot
print("=" * 60)
print("  Sending test messages to group chat")
print("=" * 60)

for name, cfg in bots.items():
    username = cfg['username']
    num = cfg['num']
    msg = f"@{username} 帮我写一个计算从1加到{num}的python脚本"

    cmd = (
        f'curl -s --resolve api.telegram.org:443:{TG_PROXY_IP} '
        f'"https://api.telegram.org/bot{RELAY_TOKEN}/sendMessage" '
        f'--data-urlencode "chat_id={GROUP_CHAT_ID}" '
        f'--data-urlencode "text={msg}" '
        f'--max-time 10'
    )
    r = run(cmd)
    try:
        result = json.loads(r)
        if result.get('ok'):
            msg_id = result['result']['message_id']
            print(f"  {name}: sent (msg_id={msg_id})")
        else:
            print(f"  {name}: failed - {result.get('description', r[:200])}")
    except:
        print(f"  {name}: error - {r[:200]}")

    # Small delay between messages
    time.sleep(2)

print()
print("Waiting 45s for bots to process...")
time.sleep(45)

# Check results
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
    lines = r.strip().split()[0] if r.strip() else "0"
    print(f"  Session: {latest.split('/')[-1]} ({lines} lines)")

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
                            print(f"  nodes: command={'ARRAY ✓' if is_array else 'STRING ✗'}")
                elif role == 'toolResult' and msg.get('toolName') == 'nodes':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            text = item['text']
                            if 'Validation' in text:
                                print(f"  ✗ VALIDATION ERROR")
                            elif 'dispatched' in text:
                                print(f"  ✓ DISPATCHED")
                            else:
                                print(f"  Result: {text[:150]}")
            except:
                pass
    else:
        # Check last messages
        r = run(f'{docker} exec {container} sh -c "tail -5 {latest} 2>/dev/null"')
        for line in r.strip().split('\n')[-3:]:
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                role = msg.get('role', '?')
                if role == 'assistant':
                    content = msg.get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            print(f"  Last: {item['text'][:200]}")
                        elif isinstance(item, dict) and item.get('type') == 'toolCall':
                            print(f"  Tool: {item.get('name')}({json.dumps(item.get('arguments',{}))[:200]})")
            except:
                pass

c.close()
