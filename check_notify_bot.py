#!/usr/bin/env python3
"""检查 Gateway 的 Telegram 通知 bot 配置"""
import paramiko
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def run_cmd_mac(cmd, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

print("=" * 70)
print("1. Gateway settings (通知配置)")
print("=" * 70)
out, _ = run_cmd_mac('curl -s http://localhost:8080/api/settings')
try:
    settings = json.loads(out)
    for k, v in settings.items():
        if 'token' in k.lower() or 'telegram' in k.lower() or 'chat' in k.lower() or 'cool' in k.lower() or 'notif' in k.lower():
            # 部分隐藏 token
            val = str(v)
            if 'token' in k.lower() and len(val) > 20:
                print(f"  {k} = {val[:15]}...{val[-10:]}")
            else:
                print(f"  {k} = {val}")
except:
    print(out[:1000])

print("\n" + "=" * 70)
print("2. telegram.js 中的 bot token 来源")
print("=" * 70)
out, _ = run_cmd_mac('cat /Users/fangjin/llm-gateway/telegram.js')
for line in out.strip().split('\n'):
    print(f"  {line}")

print("\n" + "=" * 70)
print("3. Gateway 数据库中的 settings 表")
print("=" * 70)
out, _ = run_cmd_mac('/opt/homebrew/bin/node -e "import(\\"/Users/fangjin/llm-gateway/db.js\\").then(db => { const rows = db.getAllSettings(); console.log(JSON.stringify(rows, null, 2)); }).catch(e => console.error(e.message))" 2>&1')
print(out[:2000] if out else "(无输出)")

# 直接查 sqlite
out, _ = run_cmd_mac('sqlite3 /Users/fangjin/llm-gateway/data/gateway.db "SELECT * FROM settings;" 2>/dev/null')
print(f"\n  SQLite 直接查询: {out[:1000] if out else '(无法查询)'}")
