#!/usr/bin/env python3
"""深挖 Gateway 控制台日志 + bot fetch failed 详情"""
import paramiko
import json

def run_cmd_mac(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out, err

PATH = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; '

print("=" * 70)
print("1. Gateway 控制台日志（17:20 ~ 17:30 时间段）")
print("=" * 70)
# Gateway 在 nohup 下运行，stdout 写入 nohup.out
out, _ = run_cmd_mac('grep -n "17:2[0-9]\\|Router\\|Fallback\\|cascade\\|switch\\|error\\|timeout" /Users/fangjin/llm-gateway/nohup.out 2>/dev/null | tail -50')
print(out[:3000] if out else "(无匹配)")

# 也检查是否有单独的日志文件
out2, _ = run_cmd_mac('ls -la /Users/fangjin/llm-gateway/logs/ 2>/dev/null; ls -la /Users/fangjin/llm-gateway/*.log 2>/dev/null')
print(f"\n日志文件: {out2.strip() or '(无)'}")

print("\n" + "=" * 70)
print("2. Gateway nohup.out 最后 80 行")
print("=" * 70)
out, _ = run_cmd_mac('tail -80 /Users/fangjin/llm-gateway/nohup.out 2>/dev/null')
# 过滤掉重复的 ERR_DLOPEN_FAILED
lines = out.strip().split('\n')
seen_dlopen = False
for line in lines:
    if 'ERR_DLOPEN_FAILED' in line or 'better_sqlite3' in line:
        if not seen_dlopen:
            print("  (... better-sqlite3 ERR_DLOPEN_FAILED 重复多次 ...)")
            seen_dlopen = True
        continue
    seen_dlopen = False
    print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("3. Gateway 进程的 stdout/stderr（最新）")
print("=" * 70)
out, _ = run_cmd_mac('ps aux | grep "node server.js" | grep -v grep')
pid_line = out.strip()
if pid_line:
    pid = pid_line.split()[1]
    print(f"  PID: {pid}")
    # 检查 nohup.out 大小
    out2, _ = run_cmd_mac('wc -l /Users/fangjin/llm-gateway/nohup.out 2>/dev/null; ls -lh /Users/fangjin/llm-gateway/nohup.out 2>/dev/null')
    print(f"  nohup.out: {out2.strip()}")

print("\n" + "=" * 70)
print("4. Aling-gateway 的 fetch failed 详细上下文")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker logs --tail 200 aling-gateway 2>&1 | grep -B3 -A3 "fetch failed" | tail -40')
print(out[:2000] if out else "(无)")

print("\n" + "=" * 70)
print("5. Aling-gateway 17:20~17:30 的日志")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker logs --since "2026-02-09T17:20:00Z" --until "2026-02-09T17:35:00Z" aling-gateway 2>&1 | tail -30')
print(out[:2000] if out else "(该时段无日志)")

print("\n" + "=" * 70)
print("6. deploy-openclaw-gateway-1 (Alin) 17:20~17:30 的日志")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker logs --since "2026-02-09T17:20:00Z" --until "2026-02-09T17:35:00Z" deploy-openclaw-gateway-1 2>&1 | tail -30')
print(out[:2000] if out else "(该时段无日志)")

print("\n" + "=" * 70)
print("7. 谁是发送请求的？查看 Gateway 日志中 17:26 附近的请求")
print("=" * 70)
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=200"')
try:
    logs = json.loads(out)
    # 17:26:42 UTC = 1770658002
    target = 1770658002
    print(f"  通知时间: {target} (17:26:42 UTC)")
    print(f"  日志总数: {len(logs)}, ID范围: {logs[-1]['id']}~{logs[0]['id']}")
    print(f"  最新日志时间: {logs[0]['timestamp']} (距通知 {logs[0]['timestamp'] - target:+d}s)")
    print(f"  最旧日志时间: {logs[-1]['timestamp']} (距通知 {logs[-1]['timestamp'] - target:+d}s)")
    
    # 找通知前后的请求
    nearby = sorted([l for l in logs if abs(l['timestamp'] - target) < 600], key=lambda x: x['timestamp'])
    print(f"\n  通知前后10分钟的请求 ({len(nearby)}条):")
    for l in nearby:
        diff = l['timestamp'] - target
        flag = ' <<<' if abs(diff) < 30 else ''
        print(f"    ID={l['id']} T+{diff:+5d}s | {l.get('client_name','?'):10} | {l.get('provider_name',''):20} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from',''):15} | err={l.get('error_type','')}{flag}")
except Exception as e:
    print(f"解析失败: {e}")
    print(out[:500])

print("\n" + "=" * 70)
print("8. 实时测试：现在通过 Gateway 发一个请求，看路由到哪里")
print("=" * 70)
out, _ = run_cmd_mac('''curl -s -w "\\nHTTP:%{http_code} TIME:%{time_total}s" -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 5 --max-time 30''')
print(out[:500])

# 查看刚才的请求是否记录了
import time
time.sleep(2)
out2, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=3"')
try:
    logs = json.loads(out2)
    for l in logs[:3]:
        print(f"  ID={l['id']} | {l.get('client_name','?')} | {l.get('provider_name','')} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','')}")
except:
    pass
