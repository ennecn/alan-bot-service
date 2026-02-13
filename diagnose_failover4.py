#!/usr/bin/env python3
"""最终诊断 - 查看 getProviderForModel, fallback.js, 和最新日志"""
import paramiko
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
print("1. getProviderForModel 函数（provider过滤逻辑）")
print("=" * 60)
out, _ = run_cmd('grep -n -A40 "function getProviderForModel" /Users/fangjin/llm-gateway/router.js')
print(out[:3000])

print("\n" + "=" * 60)
print("2. isProviderAvailable 函数")
print("=" * 60)
out, _ = run_cmd('grep -n -A20 "function isProviderAvailable" /Users/fangjin/llm-gateway/router.js')
print(out[:2000])

print("\n" + "=" * 60)
print("3. fallback.js 完整内容")
print("=" * 60)
out, _ = run_cmd('cat /Users/fangjin/llm-gateway/fallback.js 2>/dev/null')
print(out[:5000])

print("\n" + "=" * 60)
print("4. router.js 前340行（provider排序逻辑）")
print("=" * 60)
out, _ = run_cmd('sed -n "310,360p" /Users/fangjin/llm-gateway/router.js')
print(out)

print("\n" + "=" * 60)
print("5. 最新的日志（刚刚查询）")
print("=" * 60)
out, _ = run_cmd('curl -s "http://localhost:8080/api/logs?limit=10"')
try:
    logs = json.loads(out)
    for l in logs:
        print(f"  ID={l['id']} TS={l['timestamp']} | {l.get('client_name','?')} | {l.get('provider_name','')} | {l.get('model','')} | HTTP {l.get('status_code','?')} | latency={l.get('latency_ms','')}ms | cascade={l.get('cascaded_from','')} | err={l.get('error_type','')} {(l.get('error_message','') or '')[:100]}")
except:
    print(out[:2000])

print("\n" + "=" * 60)
print("6. incrementErrorCount 函数 (db.js)")
print("=" * 60)
out, _ = run_cmd('grep -n -A15 "incrementErrorCount\\|function.*ErrorCount" /Users/fangjin/llm-gateway/db.js')
print(out[:2000])

print("\n" + "=" * 60)
print("7. resetProviderHealth 函数 (db.js)")
print("=" * 60)
out, _ = run_cmd('grep -n -A10 "resetProviderHealth" /Users/fangjin/llm-gateway/db.js')
print(out[:1500])

print("\n" + "=" * 60)
print("8. MAX_ERRORS 或错误阈值配置")
print("=" * 60)
out, _ = run_cmd('grep -n "MAX_ERROR\\|max_error\\|error.*threshold\\|error.*limit" /Users/fangjin/llm-gateway/router.js /Users/fangjin/llm-gateway/db.js /Users/fangjin/llm-gateway/fallback.js 2>/dev/null')
print(out or "(not found)")

print("\n" + "=" * 60)
print("9. telegram.js notifyProviderSwitch 实现")
print("=" * 60)
out, _ = run_cmd('grep -n -A30 "notifyProviderSwitch" /Users/fangjin/llm-gateway/telegram.js')
print(out[:2000])
