#!/usr/bin/env python3
"""诊断 LLM Gateway Failover 原因"""
import paramiko
import sys
import json

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out, err

print("=" * 60)
print("1. Gateway 最近的日志（最后 100 行）")
print("=" * 60)
out, err = run_cmd('tail -100 /Users/fangjin/llm-gateway/gateway.log 2>/dev/null || tail -100 /Users/fangjin/llm-gateway/nohup.out 2>/dev/null')
print(out or "(no output)")
if err:
    print("STDERR:", err)

print("\n" + "=" * 60)
print("2. Gateway 进程状态")
print("=" * 60)
out, err = run_cmd('ps aux | grep -i "llm-gateway\\|node.*server" | grep -v grep')
print(out or "(no process found)")

print("\n" + "=" * 60)
print("3. Provider 状态（API 查询）")
print("=" * 60)
out, err = run_cmd('curl -s http://localhost:8080/api/providers')
print(out[:3000] if out else "(no output)")

print("\n" + "=" * 60)
print("4. 最近的 failover 日志")
print("=" * 60)
out, err = run_cmd('grep -i "failover\\|cascade\\|switch\\|error\\|fail\\|timeout\\|429\\|503\\|502" /Users/fangjin/llm-gateway/gateway.log 2>/dev/null | tail -50')
if not out:
    out2, _ = run_cmd('grep -i "failover\\|cascade\\|switch\\|error\\|fail\\|timeout\\|429\\|503\\|502" /Users/fangjin/llm-gateway/nohup.out 2>/dev/null | tail -50')
    out = out2
print(out or "(no failover logs found)")

print("\n" + "=" * 60)
print("5. 直接测试 Codesome 连通性")
print("=" * 60)
out, err = run_cmd('''curl -s -w "\\nHTTP_CODE:%{http_code}\\nTIME:%{time_total}s" -X POST https://v3.codesome.cn/v1/messages \
  -H "x-api-key: sk-ant-api03-workhard" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}' \
  --connect-timeout 10 --max-time 30''')
print(out or "(no output)")
if err:
    print("STDERR:", err)

print("\n" + "=" * 60)
print("6. Gateway 健康检查端点")
print("=" * 60)
out, err = run_cmd('curl -s http://localhost:8080/api/health 2>/dev/null || curl -s http://localhost:8080/health 2>/dev/null')
print(out or "(no output)")

print("\n" + "=" * 60)
print("7. Provider 健康检查记录")
print("=" * 60)
out, err = run_cmd('curl -s http://localhost:8080/api/providers/health 2>/dev/null')
print(out[:3000] if out else "(no output)")

print("\n" + "=" * 60)
print("8. Gateway 的 router.js 中 failover 逻辑")
print("=" * 60)
out, err = run_cmd('grep -n -A5 "failover\\|cascade\\|switchProvider\\|health_check\\|isHealthy\\|markUnhealthy" /Users/fangjin/llm-gateway/router.js 2>/dev/null | head -80')
print(out or "(not found in router.js)")
