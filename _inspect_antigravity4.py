#!/usr/bin/env python3
"""Check proxy logs for the failed multi-turn tool use request"""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', port=2222, username='root', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    return out

# 1. Check the failed request from the proxy log DB
print("=" * 60)
print("1. Last 3 requests from proxy_logs.db")
print("=" * 60)
out = run("""docker exec antigravity-manager python3 -c "
import sqlite3, json
conn = sqlite3.connect('/root/.antigravity_tools/proxy_logs.db')
c = conn.cursor()
rows = c.execute('SELECT id, timestamp, method, url, status, duration, model, error, mapped_model, protocol FROM request_logs ORDER BY id DESC LIMIT 5').fetchall()
for r in rows:
    print(f'ID={r[0]} | status={r[4]} | model={r[6]} | mapped={r[8]} | proto={r[9]}')
    if r[7]:
        print(f'  ERROR: {str(r[7])[:200]}')
    print()
" """)
print(out)

# 2. Get the failed request body (the multi-turn one)
print("\n" + "=" * 60)
print("2. Failed request body (multi-turn tool use)")
print("=" * 60)
out = run("""docker exec antigravity-manager python3 -c "
import sqlite3, json
conn = sqlite3.connect('/root/.antigravity_tools/proxy_logs.db')
c = conn.cursor()
rows = c.execute('SELECT id, request_body, response_body, error FROM request_logs WHERE error IS NOT NULL AND error LIKE \\\"%thought_signature%\\\" ORDER BY id DESC LIMIT 1').fetchall()
if rows:
    r = rows[0]
    print('=== Request Body ===')
    try:
        body = json.loads(r[1])
        print(json.dumps(body, indent=2, ensure_ascii=False)[:3000])
    except:
        print(str(r[1])[:3000])
    print()
    print('=== Response Body ===')
    print(str(r[2])[:2000])
    print()
    print('=== Error ===')
    print(str(r[3])[:1000])
else:
    print('No thought_signature error found in logs')
" """)
print(out)

# 3. Get a SUCCESSFUL tool use request body to compare
print("\n" + "=" * 60)
print("3. Successful tool use request+response (Test 1)")
print("=" * 60)
out = run("""docker exec antigravity-manager python3 -c "
import sqlite3, json
conn = sqlite3.connect('/root/.antigravity_tools/proxy_logs.db')
c = conn.cursor()
rows = c.execute('SELECT id, request_body, response_body FROM request_logs WHERE status=200 AND response_body LIKE \\\"%tool_calls%\\\" ORDER BY id DESC LIMIT 1').fetchall()
if rows:
    r = rows[0]
    print('=== Request Body ===')
    try:
        body = json.loads(r[1])
        print(json.dumps(body, indent=2, ensure_ascii=False)[:2000])
    except:
        print(str(r[1])[:2000])
    print()
    print('=== Response Body (first 2000 chars) ===')
    print(str(r[2])[:2000])
else:
    print('No successful tool_calls response found')
" """)
print(out)

# 4. Check the Gemini thought-signature documentation link
print("\n" + "=" * 60)
print("4. Understanding the thought_signature requirement")
print("=" * 60)
print("""
The error says: 'Function call is missing a thought_signature in functionCall parts'
Reference: https://ai.google.dev/gemini-api/docs/thought-signatures

This means Gemini 3 returns a thought_signature field when it generates a tool call.
When sending the tool result back, the ORIGINAL tool call must include this 
thought_signature. If the Antigravity proxy strips it during OpenAI format conversion,
the multi-turn roundtrip will fail.

Key question: Does Antigravity's response include the thought_signature anywhere
that we could preserve and pass back?
""")

# 5. Check the FULL response of a successful tool use (looking for hidden fields)
print("=" * 60)
print("5. Full response of successful tool call (looking for thought_signature)")
print("=" * 60)
out = run("""docker exec antigravity-manager python3 -c "
import sqlite3, json
conn = sqlite3.connect('/root/.antigravity_tools/proxy_logs.db')
c = conn.cursor()
rows = c.execute('SELECT response_body FROM request_logs WHERE status=200 AND response_body LIKE \\\"%tool_calls%\\\" ORDER BY id DESC LIMIT 1').fetchall()
if rows:
    resp = rows[0][0]
    print(resp[:5000])
    if 'thought_signature' in resp:
        print('\\n>>> thought_signature FOUND in response!')
    else:
        print('\\n>>> thought_signature NOT in response (stripped by Antigravity conversion)')
else:
    print('No data')
" """)
print(out)

# 6. Check Antigravity version and if there are newer versions
print("\n" + "=" * 60)
print("6. Current version and update check")
print("=" * 60)
out = run('docker exec antigravity-manager cat /root/.antigravity_tools/warmup_history.json 2>/dev/null | head -5')
print(f"warmup_history (first 5 lines):\n{out}")

out = run('docker images lbjlaq/antigravity-manager --format "{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}"')
print(f"\nLocal images:\n{out}")

vps.close()
print("\n[DONE]")
