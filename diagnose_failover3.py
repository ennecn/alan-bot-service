#!/usr/bin/env python3
"""深入诊断 - 查看 router.js cascade 逻辑和更多日志"""
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
print("1. router.js 中 cascade/failover 核心逻辑（第350-420行）")
print("=" * 60)
out, _ = run_cmd('sed -n "340,430p" /Users/fangjin/llm-gateway/router.js')
print(out)

print("\n" + "=" * 60)
print("2. router.js 中 getEligibleProviders 逻辑")
print("=" * 60)
out, _ = run_cmd('grep -n -B2 -A30 "getEligible\\|function.*eligible" /Users/fangjin/llm-gateway/router.js | head -60')
print(out or "(not found)")

print("\n" + "=" * 60)
print("3. router.js 中错误处理和 markUnhealthy 逻辑")
print("=" * 60)
out, _ = run_cmd('grep -n -B2 -A10 "markUnhealthy\\|incrementError\\|error_count\\|MAX_ERROR" /Users/fangjin/llm-gateway/router.js | head -80')
print(out or "(not found)")

print("\n" + "=" * 60)
print("4. 最近100条日志中所有cascade记录（完整信息）")
print("=" * 60)
out, _ = run_cmd('curl -s "http://localhost:8080/api/logs?limit=100"')
try:
    logs = json.loads(out)
    cascade_logs = [l for l in logs if l.get('cascaded_from')]
    error_logs = [l for l in logs if l.get('error_type') or (l.get('status_code') and l.get('status_code') >= 400)]
    
    print(f"  总日志数: {len(logs)}")
    print(f"  Cascade 记录数: {len(cascade_logs)}")
    print(f"  错误记录数: {len(error_logs)}")
    
    print("\n  --- Cascade 记录 ---")
    for l in cascade_logs:
        print(f"    ID={l['id']} TS={l['timestamp']} | {l.get('client_name','?')} | {l.get('cascaded_from','')} -> {l.get('provider_name','')} | {l.get('model','')} | HTTP {l.get('status_code','?')} | err={l.get('error_type','')} {(l.get('error_message','') or '')[:120]}")
    
    print("\n  --- 错误记录 ---")
    for l in error_logs:
        print(f"    ID={l['id']} TS={l['timestamp']} | {l.get('client_name','?')} | {l.get('provider_name','')} | {l.get('model','')} | HTTP {l.get('status_code','?')} | err={l.get('error_type','')} {(l.get('error_message','') or '')[:120]}")
except Exception as e:
    print(f"Parse error: {e}")
    print(out[:2000])

print("\n" + "=" * 60)
print("5. notifyProviderSwitch 函数逻辑")
print("=" * 60)
out, _ = run_cmd('grep -n -B2 -A20 "notifyProviderSwitch" /Users/fangjin/llm-gateway/router.js | head -40')
print(out or "(not found)")
out2, _ = run_cmd('grep -n -B2 -A20 "notifyProviderSwitch" /Users/fangjin/llm-gateway/server.js | head -40')
print(out2 or "(not found in server.js)")

print("\n" + "=" * 60)
print("6. lastActiveProvider 跟踪逻辑")
print("=" * 60)
out, _ = run_cmd('grep -n -B2 -A5 "lastActiveProvider\\|lastProvider\\|activeProvider" /Users/fangjin/llm-gateway/router.js | head -40')
print(out or "(not found)")

print("\n" + "=" * 60)
print("7. 查看通知时间戳附近的请求（17:26 = ~1770658002）")
print("=" * 60)
out, _ = run_cmd('curl -s "http://localhost:8080/api/logs?limit=100"')
try:
    logs = json.loads(out)
    # 17:26:42 UTC = 1770658002
    target_ts = 1770658002
    nearby = [l for l in logs if abs(l.get('timestamp', 0) - target_ts) < 300]  # within 5 min
    print(f"  通知时间 ({target_ts}) 附近的请求 (±5分钟):")
    for l in nearby:
        diff = l['timestamp'] - target_ts
        print(f"    ID={l['id']} TS={l['timestamp']} (diff={diff:+d}s) | {l.get('client_name','?')} | {l.get('provider_name','')} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','')} | err={l.get('error_type','')}")
except Exception as e:
    print(f"Parse error: {e}")
