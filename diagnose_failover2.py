#!/usr/bin/env python3
"""深入诊断 Failover 原因 - 查看请求日志和错误详情"""
import paramiko
import json
import sys

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
print("1. 最近的请求日志（包含错误和cascade信息）")
print("=" * 60)
out, _ = run_cmd('curl -s "http://localhost:8080/api/logs?limit=30"')
try:
    logs = json.loads(out)
    for log in logs:
        ts = log.get('timestamp', '?')
        provider = log.get('provider_name', '?')
        model = log.get('model', '?')
        status = log.get('status_code', '?')
        latency = log.get('latency_ms', '?')
        cascaded = log.get('cascaded_from', '')
        error_type = log.get('error_type', '')
        error_msg = log.get('error_message', '')
        client_name = log.get('client_name', '?')
        
        flag = ''
        if cascaded:
            flag = f' [CASCADE from {cascaded}]'
        if error_type:
            flag += f' [ERR: {error_type}]'
        if error_msg:
            flag += f' [{error_msg[:100]}]'
        
        print(f"  {ts} | {client_name:10} | {provider:20} | {model:35} | HTTP {status} | {latency}ms{flag}")
except Exception as e:
    print(f"Parse error: {e}")
    print(out[:2000])

print("\n" + "=" * 60)
print("2. Codesome 的 error_count 和 last_check 详情")
print("=" * 60)
out, _ = run_cmd('curl -s "http://localhost:8080/api/providers/2"')
try:
    p = json.loads(out)
    print(f"  Name: {p.get('name')}")
    print(f"  Health: {p.get('health_status')}")
    print(f"  Error count: {p.get('error_count')}")
    print(f"  Exhausted until: {p.get('exhausted_until')}")
    print(f"  Last check: {p.get('last_check_at')}")
    print(f"  Enabled: {p.get('enabled')}")
    print(f"  Recovery minutes: {p.get('recovery_minutes')}")
except Exception as e:
    print(f"Parse error: {e}")
    print(out[:1000])

print("\n" + "=" * 60)
print("3. 用正确的 API Key 直接测试 Codesome")
print("=" * 60)
out, _ = run_cmd('''curl -s -w "\\nHTTP_CODE:%{http_code}\\nTIME:%{time_total}s" -X POST https://v3.codesome.cn/v1/messages \
  -H "x-api-key: sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":100,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 10 --max-time 60''')
print(out[:2000])

print("\n" + "=" * 60)
print("4. Gateway router.js 中判断 failover 的关键逻辑")
print("=" * 60)
# 查看 isHealthy 和 markUnhealthy 逻辑
out, _ = run_cmd('grep -n "isHealthy\\|markUnhealthy\\|error_count\\|MAX_ERRORS\\|getEligible" /Users/fangjin/llm-gateway/router.js | head -30')
print(out or "(not found)")

print("\n" + "=" * 60)
print("5. Gateway server.js 中的健康检查逻辑")
print("=" * 60)
out, _ = run_cmd('grep -n "health_check\\|healthCheck\\|isHealthy\\|setInterval\\|cron" /Users/fangjin/llm-gateway/server.js | head -20')
print(out or "(not found)")

print("\n" + "=" * 60)
print("6. 看看 cascaded_from 有值的最近请求")
print("=" * 60)
out, _ = run_cmd('curl -s "http://localhost:8080/api/logs?limit=50"')
try:
    logs = json.loads(out)
    cascaded = [l for l in logs if l.get('cascaded_from')]
    print(f"  最近 50 条日志中有 {len(cascaded)} 条 cascade 记录:")
    for log in cascaded[:20]:
        ts = log.get('timestamp', '?')
        provider = log.get('provider_name', '?')
        model = log.get('model', '?')
        status = log.get('status_code', '?')
        cascaded_from = log.get('cascaded_from', '')
        error_type = log.get('error_type', '')
        error_msg = log.get('error_message', '')
        client_name = log.get('client_name', '?')
        print(f"    {ts} | {client_name} | from={cascaded_from} -> {provider} | {model} | HTTP {status} | err={error_type} {error_msg[:80]}")
except Exception as e:
    print(f"Parse error: {e}")
    print(out[:1000])
