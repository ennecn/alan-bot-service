#!/usr/bin/env python3
"""Dump the last messages from each bot's session to find the validation error."""
import paramiko
import sys
import json

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    si, so, se = c.exec_command(cmd, timeout=30)
    return so.read().decode('utf-8', errors='replace') + se.read().decode('utf-8', errors='replace')

docker = "/usr/local/bin/docker"

# Dump last 10 messages from each session
bots = {
    "Lumi": ("lumi-gateway", "d78bda1e-dbfb-484b-ab5d-95161eb3edba"),
    "阿凛": ("deploy-openclaw-gateway-1", "37853765-2dc6-4678-94ae-04d2a9c2f466"),
    "阿澪": ("aling-gateway", None),  # will find latest
    "Lain": ("lain-gateway", None),
}

for name, (container, session_id) in bots.items():
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")

    if not session_id:
        r = run(f'{docker} exec {container} sh -c "ls -t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -1"')
        session_id_path = r.strip()
    else:
        session_id_path = f"/home/node/.openclaw/agents/main/sessions/{session_id}.jsonl"

    if not session_id_path:
        print("  No session found")
        continue

    # Get last 15 lines
    r = run(f'{docker} exec {container} sh -c "tail -15 {session_id_path} 2>/dev/null"')
    if r.strip():
        for line in r.strip().split('\n'):
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                role = msg.get('role', '?')
                ts = obj.get('timestamp', '')

                if role == 'assistant':
                    content = msg.get('content', [])
                    texts = []
                    tools = []
                    for item in content:
                        if isinstance(item, dict):
                            if item.get('type') == 'text':
                                texts.append(item['text'][:200])
                            elif item.get('type') == 'toolCall':
                                tools.append(f"{item.get('name')}({json.dumps(item.get('arguments',{}))[:300]})")
                    if texts:
                        print(f"  [{ts}] ASSISTANT: {' | '.join(texts)}")
                    if tools:
                        print(f"  [{ts}] TOOL_CALL: {' | '.join(tools)}")

                elif role == 'toolResult':
                    tool_name = msg.get('toolName', '?')
                    content = msg.get('content', [])
                    result_text = ""
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                result_text += item['text'][:500]
                    elif isinstance(content, str):
                        result_text = content[:500]
                    print(f"  [{ts}] TOOL_RESULT ({tool_name}): {result_text[:500]}")

                elif role == 'user':
                    content = msg.get('content', '')
                    if isinstance(content, str):
                        print(f"  [{ts}] USER: {content[:200]}")
                    elif isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                print(f"  [{ts}] USER: {item['text'][:200]}")

            except json.JSONDecodeError:
                pass

c.close()
