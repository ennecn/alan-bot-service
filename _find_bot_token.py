#!/usr/bin/env python3
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmds = [
    # Check old gateway DB for telegram settings
    "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && sqlite3 /Users/fangjin/llm-gateway/data/gateway.db \"SELECT key, value FROM settings;\"",
    # Check old gateway telegram.js
    "cat /Users/fangjin/llm-gateway/telegram.js 2>/dev/null",
    # Check env files
    "cat /Users/fangjin/llm-gateway/.env 2>/dev/null",
    # Check telegram-proxy for bot token
    "cat /Users/fangjin/telegram-proxy.js 2>/dev/null | head -20",
]

for cmd in cmds:
    print(f"\n{'='*60}")
    print(f"CMD: {cmd[:80]}...")
    print(f"{'='*60}")
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out[:2000])
    if err:
        print(f"STDERR: {err[:500]}")

client.close()
