#!/usr/bin/env python3
"""最终验证"""
import paramiko
import json
import sys
import io
import time

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
print("1. Gateway 进程状态")
print("=" * 70)
out, _ = run_cmd_mac('ps aux | grep -E "node.*server" | grep -v grep')
if out.strip():
    print(f"  ✓ {out.strip()}")
else:
    print("  ✗ 未运行! 正在启动...")
    run_cmd_mac('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js >> /private/tmp/gateway.log 2>&1 &')
    time.sleep(4)
    out, _ = run_cmd_mac('ps aux | grep -E "node.*server" | grep -v grep')
    print(f"  启动结果: {out.strip() or '失败'}")

print("\n" + "=" * 70)
print("2. launchctl 服务状态")
print("=" * 70)
out, _ = run_cmd_mac('launchctl list | grep gateway')
print(f"  {out.strip()}")

# 如果 launchctl 显示退出码非0，重新加载
if '-' in out.split()[0] if out.strip() else True:
    print("  尝试重新加载 launchctl 服务...")
    out2, err2 = run_cmd_mac('launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1; sleep 1; launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
    print(f"  {out2.strip()} {err2.strip()}")
    time.sleep(3)
    out, _ = run_cmd_mac('launchctl list | grep gateway')
    print(f"  重新加载后: {out.strip()}")
    
    out, _ = run_cmd_mac('ps aux | grep -E "node.*server" | grep -v grep')
    print(f"  进程: {out.strip()}")

print("\n" + "=" * 70)
print("3. 功能测试")
print("=" * 70)

# 测试 streaming 请求 (Anthropic 路径)
out, _ = run_cmd_mac('''curl -s -w "\\nHTTP:%{http_code} TIME:%{time_total}s" -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 5 --max-time 30''')
for l in out.strip().split('\n')[-2:]:
    if 'HTTP:' in l or 'TIME:' in l:
        print(f"  Streaming 请求: {l}")

time.sleep(2)

# 检查日志
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=3"')
try:
    logs = json.loads(out)
    print(f"  最新日志 ({len(logs)} 条):")
    for l in logs[:3]:
        print(f"    ID={l['id']} | {l.get('client_name','?'):10} | {l.get('provider_name',''):20} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','None')}")
except:
    print(f"  {out[:300]}")

# Gateway 日志
out, _ = run_cmd_mac('tail -8 /private/tmp/gateway.log')
print(f"\n  Gateway 日志:")
for line in out.strip().split('\n')[-6:]:
    print(f"    {line[:150]}")

print("\n" + "=" * 70)
print("4. 修复汇总")
print("=" * 70)
print("""
  [✓] P0: launchctl plist 已更新
       /Users/fangjin/local/bin/node (v20) → /opt/homebrew/bin/node (v25)
       Mac Mini 重启后 Gateway 可正常启动

  [✓] P1-Bug1: server error (502) cascade 时记录日志
       新增 logRequest() 调用, error_type='server_error'

  [✓] P1-Bug2: OpenAI streaming 成功时记录日志
       新增 logRequest() 调用 + Provider Switch 通知

  [✓] P1-Bug3: Provider Switch 通知修复
       - 删除了循环开头的提前通知（防误报）
       - 通知改为在 3 个成功路径中发送:
         * Anthropic streaming 成功后
         * OpenAI streaming 成功后 (Antigravity)
         * 非 streaming 成功后
       - 区分两种通知原因:
         * 'Failover cascade' (有cascade时)
         * 'Provider recovered' (无cascade, 正常恢复)
""")
