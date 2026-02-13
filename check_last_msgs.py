#!/usr/bin/env python3
"""Check the last few messages in 阿凛's session."""
import paramiko
import json

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
CONTAINER = 'deploy-openclaw-gateway-1'
SESSION_ID = '29c76df5-c172-44ec-96fd-ee6027e978ec'
P = 'export PATH=/usr/local/bin:/usr/bin:/bin'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

# Copy session file out
_, o, e = client.exec_command(
    f'{P} && docker cp {CONTAINER}:/home/node/.openclaw/agents/main/sessions/{SESSION_ID}.jsonl /tmp/check_session.jsonl'
)
o.read()

sftp = client.open_sftp()
with sftp.open('/tmp/check_session.jsonl', 'r') as f:
    content = f.read().decode('utf-8', errors='replace')
sftp.close()
client.close()

lines = content.strip().split('\n')
print(f"Total lines: {len(lines)}")
print()

# Show last 10 message entries
msgs = []
for line in lines:
    try:
        entry = json.loads(line)
        if entry.get('type') == 'message':
            msgs.append(entry)
    except:
        pass

print(f"Total messages: {len(msgs)}")
print()

# Show last 5 messages (summary)
for msg in msgs[-5:]:
    role = msg['message']['role']
    ts = msg.get('timestamp', '')
    content_parts = msg['message'].get('content', [])

    if role == 'user':
        for part in content_parts:
            if part.get('type') == 'text':
                text = part['text'][:200]
                print(f"[{ts}] USER: {text}")
    elif role == 'assistant':
        for part in content_parts:
            if part.get('type') == 'text':
                text = part['text'][:200]
                print(f"[{ts}] ASSISTANT: {text}")
            elif part.get('type') == 'toolCall':
                print(f"[{ts}] ASSISTANT: [tool_call: {part['name']}({json.dumps(part.get('arguments',{}), ensure_ascii=False)[:100]})]")
    elif role == 'toolResult':
        tool = msg['message'].get('toolName', '?')
        result_parts = msg['message'].get('content', [])
        result_text = ''
        for rp in result_parts:
            if rp.get('type') == 'text':
                result_text = rp['text'][:150]
        print(f"[{ts}] TOOL_RESULT ({tool}): {result_text}")
    print()
