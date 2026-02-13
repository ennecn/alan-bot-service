#!/usr/bin/env python3
"""最后的关联分析"""
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

PATH = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; '

print("=" * 70)
print("[1] Codesome 502 出现的所有时间点")
print("=" * 70)
out, _ = run_cmd_mac('grep -n "502" /private/tmp/gateway.log')
for line in out.strip().split('\n'):
    print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("[2] Gateway 日志中所有 server error")
print("=" * 70)
out, _ = run_cmd_mac('grep -n "server error\\|returned 5" /private/tmp/gateway.log')
for line in out.strip().split('\n'):
    print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("[3] 通知发送的所有时间点")
print("=" * 70)
out, _ = run_cmd_mac('grep -n "Notification sent\\|Telegram" /private/tmp/gateway.log')
for line in out.strip().split('\n'):
    print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("[4] Antigravity 成功 streaming 的时间点")
print("=" * 70)
out, _ = run_cmd_mac('grep -n "Streaming OpenAI.*Antigravity" /private/tmp/gateway.log')
for line in out.strip().split('\n'):
    print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("[5] 完整时间线（所有 Router 事件）")
print("=" * 70)
out, _ = run_cmd_mac('grep -n "\\[Router\\]\\|\\[Fallback\\]\\|\\[Telegram\\]\\|POST /v1/messages" /private/tmp/gateway.log | tail -80')
for line in out.strip().split('\n'):
    print(f"  {line[:200]}")

print("\n" + "=" * 70)
print("[6] 现在测试 Codesome 是否还在返回 502")
print("=" * 70)
for i in range(3):
    out, _ = run_cmd_mac(f'''curl -s -w "\\nHTTP:%{{http_code}} TIME:%{{time_total}}s" -X POST https://v3.codesome.cn/v1/messages \
      -H "x-api-key: sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8" \
      -H "content-type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      -d '{{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"stream":true,"messages":[{{"role":"user","content":"say ok"}}]}}' \
      --connect-timeout 5 --max-time 30''')
    # 只看最后两行 (HTTP code + time)
    lines = out.strip().split('\n')
    for l in lines[-3:]:
        if 'HTTP:' in l or 'event:' in l:
            print(f"  测试{i+1}: {l}")
    import time
    time.sleep(1)

print("\n" + "=" * 70)
print("[7] launchctl plist 中的 node 路径 vs 实际运行路径")
print("=" * 70)
out, _ = run_cmd_mac('ls -la /Users/fangjin/local/bin/node 2>/dev/null')
print(f"  plist 中的 node: /Users/fangjin/local/bin/node -> {out.strip() or '(不存在!)'}")
out, _ = run_cmd_mac('/Users/fangjin/local/bin/node -v 2>/dev/null')
print(f"  plist node 版本: {out.strip() or '(无法执行)'}")
out, _ = run_cmd_mac('/opt/homebrew/bin/node -v')
print(f"  当前运行的 node: v25.2.1 (via /opt/homebrew/bin/node)")

print("\n" + "=" * 70)
print("[8] OpenAI streaming 路径是否有 logRequest 调用")
print("=" * 70)
out, _ = run_cmd_mac('sed -n "498,520p" /Users/fangjin/llm-gateway/router.js')
print("  router.js 498-520 (OpenAI streaming path):")
for line in out.strip().split('\n'):
    print(f"    {line}")

print("\n" + "=" * 70)
print("[9] server error cascade 路径是否有 logRequest 调用")
print("=" * 70)
out, _ = run_cmd_mac('sed -n "620,630p" /Users/fangjin/llm-gateway/router.js')
print("  router.js 620-630 (server error handler):")
for line in out.strip().split('\n'):
    print(f"    {line}")
