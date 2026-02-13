#!/usr/bin/env python3
"""检查 gateway.log 和真正触发cascade的请求"""
import paramiko
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def run_cmd_mac(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

PATH = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; '

print("=" * 70)
print("1. gateway.log 最后 100 行")
print("=" * 70)
out, _ = run_cmd_mac('tail -100 /Users/fangjin/llm-gateway/gateway.log 2>/dev/null')
print(out[:5000])

print("\n" + "=" * 70)
print("2. gateway.log 中 Router/Fallback/cascade 相关")
print("=" * 70)
out, _ = run_cmd_mac('grep -i "router\\|fallback\\|cascade\\|switch\\|error\\|fail\\|timeout\\|429\\|502\\|503" /Users/fangjin/llm-gateway/gateway.log 2>/dev/null | tail -50')
print(out[:3000] if out else "(无匹配)")

print("\n" + "=" * 70)
print("3. deploy-openclaw-gateway-1 (Alin) 17:26 附近日志")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker logs --since "2026-02-09T17:20:00Z" --until "2026-02-09T17:35:00Z" deploy-openclaw-gateway-1 2>&1 | head -50')
# 替换可能导致编码问题的字符
out = out.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
print(out[:3000] if out else "(无日志)")

print("\n" + "=" * 70)
print("4. 所有容器 17:20~17:30 的日志概览")
print("=" * 70)
for c in ['deploy-openclaw-gateway-1', 'aling-gateway', 'lain-gateway', 'lumi-gateway']:
    print(f"\n  --- {c} ---")
    out, _ = run_cmd_mac(PATH + f'docker logs --since "2026-02-09T17:15:00Z" --until "2026-02-09T17:35:00Z" {c} 2>&1 | wc -l')
    count = out.strip()
    out2, _ = run_cmd_mac(PATH + f'docker logs --since "2026-02-09T17:15:00Z" --until "2026-02-09T17:35:00Z" {c} 2>&1 | grep -v "closed before connect\\|unauthorized" | tail -10')
    out2 = out2.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
    print(f"    总行数: {count}")
    if out2.strip():
        for line in out2.strip().split('\n'):
            print(f"    {line[:180]}")
    else:
        print("    (无有效日志，或全是 WS closed/unauthorized)")

print("\n" + "=" * 70)
print("5. 实时测试 + 查看 Gateway 路由决策")
print("=" * 70)
# 发一个请求，同时看 gateway.log 的变化
out, _ = run_cmd_mac('wc -l /Users/fangjin/llm-gateway/gateway.log 2>/dev/null')
before_lines = out.strip()
print(f"  gateway.log 当前行数: {before_lines}")

out, _ = run_cmd_mac('''curl -s -w "\\nHTTP:%{http_code} TIME:%{time_total}s" -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: gw-aling-5762340acf5576d395f6cb3969c88082" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-opus-4-6","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 10 --max-time 60''')
print(f"  响应: {out[:500]}")

import time
time.sleep(3)
out, _ = run_cmd_mac('wc -l /Users/fangjin/llm-gateway/gateway.log 2>/dev/null')
after_lines = out.strip()
print(f"  gateway.log 行数变化: {before_lines} -> {after_lines}")

# 看新增的日志
out, _ = run_cmd_mac(f'tail -20 /Users/fangjin/llm-gateway/gateway.log 2>/dev/null')
print(f"\n  gateway.log 最新日志:")
print(out[:2000])

print("\n" + "=" * 70)
print("6. 最新请求日志")
print("=" * 70)
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=5"')
try:
    logs = json.loads(out)
    for l in logs:
        print(f"  ID={l['id']} TS={l['timestamp']} | {l.get('client_name','?'):10} | {l.get('provider_name',''):20} | model={l.get('model','')} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','None')}")
except:
    print(out[:500])

print("\n" + "=" * 70)
print("7. Aling 容器请求的模型名 vs Gateway 的映射")
print("=" * 70)
print("  Aling 容器内请求模型: claude-opus-4-6")
print("  Codesome model_mapping: claude-opus-4-6-thinking -> claude-sonnet-4-5-thinking")
print("  Codesome model_mapping: claude-opus-4-6 -> claude-sonnet-4-5-thinking")
print("  Antigravity model_mapping: claude-opus-4-6 -> gemini-3-flash")
print("  注意: Fallback 系统可能也在做模型覆盖!")
out, _ = run_cmd_mac('cat /Users/fangjin/llm-gateway/data/fallback-state.json 2>/dev/null')
print(f"  fallback-state.json: {out.strip() or '{}'}")
