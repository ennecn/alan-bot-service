#!/usr/bin/env python3
"""Check signature-related config and look for proxy conversion logic"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', port=2222, username='root', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    return out

# 1. Full gui_config.json (especially experimental and signature_cache)
print("=" * 60)
print("1. Full gui_config.json")
print("=" * 60)
out = run('docker exec antigravity-manager cat /root/.antigravity_tools/gui_config.json')
print(out)

# 2. Search strings more broadly in the binary
print("\n" + "=" * 60)
print("2. Signature / cache related strings in binary")
print("=" * 60)
out = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "signature" | head -20')
print(f"signature: {out if out else 'NOT FOUND'}")

out = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "thought" | head -20')
print(f"\nthought: {out if out else 'NOT FOUND'}")

out = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "functioncall\\|function_call\\|tool_use\\|tool_call" | head -30')
print(f"\nfunction/tool call strings: {out if out else 'NOT FOUND'}")

# 3. The Rust binary - check for relevant crate strings
print("\n" + "=" * 60)
print("3. Rust crate/library strings")
print("=" * 60)
out = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "crates.io\\|cargo" | sort -u | head -20')
print(out if out else "NOT FOUND")

# 4. Check any proxy/converter modules in the dist JS
print("\n" + "=" * 60)
print("4. Checking dist/assets JS for tool-related code")
print("=" * 60)
out = run('docker exec antigravity-manager head -c 5000 /app/dist/assets/index-Dapurt1d.js 2>/dev/null')
print(f"First 5000 chars of JS:\n{out[:2000]}")

# 5. Look for the actual proxy handling in binary
print("\n" + "=" * 60)
print("5. Proxy/API related strings")
print("=" * 60)
out = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "chat/completions\\|/v1/\\|messages\\|generateContent" | sort -u | head -30')
print(out if out else "NOT FOUND")

# 6. Check request logs for the tool use request we sent
print("\n" + "=" * 60)
print("6. Recent proxy logs (tool use request)")
print("=" * 60)
out = run('docker logs antigravity-manager --tail 100 2>&1 | grep -i "tool\\|function\\|thought\\|signature" | tail -20')
print(out if out else "No tool-related log lines found")

# 7. Check if enable_signature_cache is related
print("\n" + "=" * 60)
print("7. Signature cache experimental setting")
print("=" * 60)
out = run("docker exec antigravity-manager python3 -c \"import json; c=json.load(open('/root/.antigravity_tools/gui_config.json')); print(json.dumps(c.get('proxy',{}).get('experimental',{}), indent=2))\"")
print(out)

# 8. Check how the binary talks to Gemini (native API or via proxy)
print("\n" + "=" * 60)
print("8. Network connections from container")
print("=" * 60)
out = run('docker exec antigravity-manager cat /etc/hosts')
print(f"hosts:\n{out}")

# 9. Check full proxy log db for the failed request
print("\n" + "=" * 60)
print("9. Last failed request log")
print("=" * 60)
out = run("docker exec antigravity-manager python3 -c \"import sqlite3,json; conn=sqlite3.connect('/root/.antigravity_tools/proxy_logs.db'); c=conn.cursor(); c.execute('SELECT name FROM sqlite_master WHERE type=\\\"table\\\"'); print('Tables:', [r[0] for r in c.fetchall()])\" 2>/dev/null")
print(out)

out = run("docker exec antigravity-manager python3 -c \"import sqlite3,json; conn=sqlite3.connect('/root/.antigravity_tools/proxy_logs.db'); c=conn.cursor(); tables=[r[0] for r in c.execute('SELECT name FROM sqlite_master WHERE type=\\\"table\\\"').fetchall()]; [print(f'Table {t}: columns={[d[1] for d in c.execute(f\\\"PRAGMA table_info({t})\\\").fetchall()]}') for t in tables[:5]]\" 2>/dev/null")
print(out)

vps.close()
print("\n[DONE]")
