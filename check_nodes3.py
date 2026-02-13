#!/usr/bin/env python3
"""Check the actual nodes tool results in session transcripts."""
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

# Get the full nodes tool result from each bot's session
bots = {
    "Lumi": ("lumi-gateway", "d78bda1e-dbfb-484b-ab5d-95161eb3edba"),
    "阿凛": ("deploy-openclaw-gateway-1", "37853765-2dc6-4678-94ae-04d2a9c2f466"),
}

for name, (container, session_id) in bots.items():
    print(f"\n{'='*60}")
    print(f"  {name}: nodes tool result")
    print(f"{'='*60}")

    session_file = f"/home/node/.openclaw/agents/main/sessions/{session_id}.jsonl"

    # Get all lines with toolResult for nodes
    r = run(f'{docker} exec {container} sh -c "grep toolResult {session_file} 2>/dev/null"')
    if r.strip():
        for line in r.strip().split('\n'):
            try:
                obj = json.loads(line)
                msg = obj.get('message', {})
                tool_name = msg.get('toolName', '')
                if tool_name == 'nodes':
                    content = msg.get('content', [])
                    print(f"  Tool: {tool_name}")
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                print(f"  Result: {item['text'][:1000]}")
                    elif isinstance(content, str):
                        print(f"  Result: {content[:1000]}")
            except:
                # Just print raw if can't parse
                if 'nodes' in line.lower():
                    print(f"  Raw: {line[:800]}")

# Also check Lain and 阿澪
print(f"\n{'='*60}")
print(f"  Lain + 阿澪: check sessions")
print(f"{'='*60}")

for name, container in [("Lain", "lain-gateway"), ("阿澪", "aling-gateway")]:
    r = run(f'{docker} exec {container} sh -c "ls -t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -1"')
    latest = r.strip()
    if latest:
        r = run(f'{docker} exec {container} sh -c "grep nodes {latest} 2>/dev/null | tail -3"')
        if r.strip():
            for line in r.strip().split('\n')[-2:]:
                print(f"  {name}: {line[:500]}")
        else:
            print(f"  {name}: no nodes tool calls in latest session")
    else:
        print(f"  {name}: no sessions found")

# Check dispatch script execution log
print(f"\n{'='*60}")
print(f"  Dispatch results")
print(f"{'='*60}")
print(run("ls -lt /Users/fangjin/claude-code-results/ 2>/dev/null | head -15"))
print(run("cat /Users/fangjin/claude-code-results/latest.json 2>/dev/null"))

c.close()
