#!/usr/bin/env python3
"""检查 Codesome 并发限制是否是 502 的真正原因"""
import paramiko
import json
import sys
import io
import time
import threading

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
print("[1] Gateway 日志中 502 的响应体内容")
print("=" * 70)
# 我们刚才的补丁添加了 responseText 记录，但之前的 502 没有记录
# 先看看 router.js 中 502 时是否读取了 response body
out, _ = run_cmd_mac('sed -n "593,630p" /Users/fangjin/llm-gateway/router.js')
print("  router.js 593-630:")
for line in out.strip().split('\n'):
    print(f"    {line[:150]}")

print("\n" + "=" * 70)
print("[2] 直接测试 Codesome 并发限制")
print("=" * 70)
print("  发送 3 个并发请求到 Codesome...")

# 用 background 方式发 3 个并发请求
concurrent_cmd = '''
API_KEY="sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8"
BASE_URL="https://v3.codesome.cn"

for i in 1 2 3; do
  (
    RESULT=$(curl -s -w "\\n---HTTP:%{http_code} TIME:%{time_total}s---" -X POST ${BASE_URL}/v1/messages \
      -H "x-api-key: ${API_KEY}" \
      -H "content-type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"messages":[{"role":"user","content":"say ok '${i}'"}]}' \
      --connect-timeout 10 --max-time 30 2>&1)
    echo "=== Request ${i} ==="
    echo "${RESULT}"
    echo "=== End ${i} ==="
  ) &
done
wait
echo "ALL DONE"
'''
out, _ = run_cmd_mac(concurrent_cmd, timeout=60)
print(out[:3000])

print("\n" + "=" * 70)
print("[3] 加大并发: 5 个同时请求")
print("=" * 70)
concurrent_cmd5 = '''
API_KEY="sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8"
BASE_URL="https://v3.codesome.cn"

for i in 1 2 3 4 5; do
  (
    RESULT=$(curl -s -w "\\n---HTTP:%{http_code} TIME:%{time_total}s---" -X POST ${BASE_URL}/v1/messages \
      -H "x-api-key: ${API_KEY}" \
      -H "content-type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":30,"messages":[{"role":"user","content":"hi '${i}'"}]}' \
      --connect-timeout 10 --max-time 30 2>&1)
    echo "=== Request ${i}: $(echo ${RESULT} | tail -1) ==="
  ) &
done
wait
echo "ALL DONE"
'''
out, _ = run_cmd_mac(concurrent_cmd5, timeout=60)
print(out[:3000])

print("\n" + "=" * 70)
print("[4] 检查 502 时间和 bot 请求时间的关联")
print("=" * 70)
# 从 gateway.log 中提取 502 前后的请求时间
out, _ = run_cmd_mac('grep -n "POST /v1/messages\\|returned 502\\|server error" /private/tmp/gateway.log | tail -40')
# 也看旧日志
out2, _ = run_cmd_mac('cat /private/tmp/gateway.log | grep -B1 "returned 502"')
print("  502 错误前后的请求:")
for line in (out + '\n' + out2).strip().split('\n'):
    line = line.strip()
    if line:
        print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("[5] 检查 isQuotaError 和 isServerError 的定义")
print("=" * 70)
out, _ = run_cmd_mac('grep -n -A10 "function isQuotaError\\|function isServerError" /Users/fangjin/llm-gateway/router.js')
print(out[:1000])

print("\n" + "=" * 70)
print("[6] 4个 bot 的活动时间线（看是否有并发）")
print("=" * 70)
out, _ = run_cmd_mac('grep -n "POST /v1/messages\\|Client identified" /private/tmp/gateway.log | tail -60')
lines = out.strip().split('\n')
# 提取时间戳和客户端
requests = []
for i, line in enumerate(lines):
    if 'POST /v1/messages' in line:
        ts = ''
        for part in line.split(']'):
            if '2026' in part:
                ts = part.split('[')[-1] if '[' in part else part
                break
        requests.append(f"  {line[:150]}")
    elif 'Client identified' in line:
        requests.append(f"    {line.split(':',1)[-1].strip()[:100]}")

for r in requests[-30:]:
    print(r)
