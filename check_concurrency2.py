#!/usr/bin/env python3
"""检查 502 时的并发情况 + streaming 并发测试"""
import paramiko
import json
import sys
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def run_cmd_mac(cmd, timeout=60):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

print("=" * 70)
print("[1] 重建旧日志的 502 时间线（从 API 日志推断）")
print("=" * 70)
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=200"')
try:
    logs = json.loads(out)
    print(f"  日志总数: {len(logs)}")
    
    # 找到 17:08-17:26 时间段的所有请求
    # 17:08 UTC ≈ 1770656904, 17:26 UTC ≈ 1770658002
    window_logs = [l for l in logs if 1770656000 <= l.get('timestamp', 0) <= 1770658500]
    
    print(f"\n  17:06~17:30 时间段的请求 ({len(window_logs)}条):")
    for l in sorted(window_logs, key=lambda x: x['timestamp']):
        ts = l['timestamp']
        mins = (ts - 1770656000) // 60
        secs = (ts - 1770656000) % 60
        rel_time = f"+{mins}m{secs:02d}s"
        provider = l.get('provider_name', '?')
        client = l.get('client_name', '?')
        status = l.get('status_code', '?')
        latency = l.get('latency_ms', '?')
        cascade = l.get('cascaded_from', '')
        error = l.get('error_type', '')
        print(f"    {rel_time} | {client:8} | {provider:20} | HTTP {status} | {latency}ms | cascade={cascade} err={error}")
except Exception as e:
    print(f"  错误: {e}")

print("\n" + "=" * 70)
print("[2] 测试 STREAMING 并发（更接近真实场景）")
print("=" * 70)
print("  发送 3 个 streaming 并发请求...")

streaming_cmd = '''
API_KEY="sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8"
BASE_URL="https://v3.codesome.cn"

for i in 1 2 3; do
  (
    START=$(date +%s%N)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST ${BASE_URL}/v1/messages \
      -H "x-api-key: ${API_KEY}" \
      -H "content-type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":200,"stream":true,"messages":[{"role":"user","content":"count from 1 to 10 slowly, number '${i}'"}]}' \
      --connect-timeout 10 --max-time 30 2>&1)
    END=$(date +%s%N)
    DURATION=$(( (END - START) / 1000000 ))
    echo "Stream ${i}: HTTP=${HTTP_CODE} TIME=${DURATION}ms"
  ) &
done
wait
echo "ALL STREAMING DONE"
'''
out, _ = run_cmd_mac(streaming_cmd, timeout=60)
print(out)

print("\n" + "=" * 70)
print("[3] 同时通过 Gateway 发请求（模拟多 bot 并发）")
print("=" * 70)
print("  通过不同 bot key 同时发 3 个请求...")

gateway_concurrent = '''
for KEY_NAME in "gw-alin-86f31cca5b0d93189ffca6887138ff41" "gw-aling-5762340acf5576d395f6cb3969c88082" "gw-lumi-6076e75c20398d61fadace7a7c3c8b68"; do
  (
    BOT=$(echo $KEY_NAME | cut -d'-' -f2)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/v1/messages \
      -H "x-api-key: ${KEY_NAME}" \
      -H "content-type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say ok"}]}' \
      --connect-timeout 10 --max-time 30 2>&1)
    echo "Bot ${BOT}: HTTP=${HTTP_CODE}"
  ) &
done
wait
echo "GATEWAY CONCURRENT DONE"
'''
out, _ = run_cmd_mac(gateway_concurrent, timeout=60)
print(out)

# 检查日志
time.sleep(2)
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=5"')
try:
    logs = json.loads(out)
    print("  日志记录:")
    for l in logs[:5]:
        print(f"    ID={l['id']} | {l.get('client_name','?'):8} | {l.get('provider_name',''):20} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','None')}")
except:
    pass

print("\n" + "=" * 70)
print("[4] 检查 Claude Code Bridge 是否也在用 Codesome")
print("=" * 70)
out, _ = run_cmd_mac('ps aux | grep cc-bridge | grep -v grep')
if out.strip():
    print(f"  CC Bridge 进程: {out.strip()[:120]}")
    out2, _ = run_cmd_mac('curl -s http://localhost:9090/health 2>/dev/null')
    print(f"  CC Bridge 健康: {out2.strip()[:200]}")
    # 检查 bridge 的 env
    out3, _ = run_cmd_mac('cat /Users/fangjin/cc-bridge/.env 2>/dev/null')
    for line in out3.strip().split('\n'):
        if 'BASE_URL' in line or 'API_KEY' in line:
            print(f"  CC Bridge env: {line[:50]}...")
else:
    print("  CC Bridge 未运行")

print("\n" + "=" * 70)
print("[5] 502 出现时的完整时间线（从旧 gateway.log 提取）")
print("=" * 70)
# 旧日志已经被覆盖了，但 API 日志可能还有
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=200"')
try:
    logs = json.loads(out)
    # 按时间排序，找到相邻的请求间隔
    sorted_logs = sorted(logs, key=lambda x: x['timestamp'])
    
    # 找到可能的并发（两个请求时间差 < 5秒）
    concurrent_pairs = []
    for i in range(1, len(sorted_logs)):
        diff = sorted_logs[i]['timestamp'] - sorted_logs[i-1]['timestamp']
        if diff < 5:
            concurrent_pairs.append((sorted_logs[i-1], sorted_logs[i], diff))
    
    print(f"  可能的并发请求（间隔 < 5秒）: {len(concurrent_pairs)} 对")
    for a, b, diff in concurrent_pairs[:10]:
        print(f"    {a.get('client_name','?'):8} ({a.get('provider_name','')} HTTP{a.get('status_code','?')}) <{diff}s> {b.get('client_name','?'):8} ({b.get('provider_name','')} HTTP{b.get('status_code','?')})")
except Exception as e:
    print(f"  错误: {e}")
