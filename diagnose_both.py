#!/usr/bin/env python3
"""排查切换逻辑 + bot状态"""
import paramiko
import json
import time

def run_cmd_mac(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out, err

PATH_PREFIX = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; '

print("=" * 70)
print("A. 切换逻辑排查")
print("=" * 70)

print("\n--- A1. fallback-state.json（tier 耗尽状态）---")
out, _ = run_cmd_mac('cat /Users/fangjin/llm-gateway/data/fallback-state.json 2>/dev/null')
print(out or "(文件不存在或为空)")

print("\n--- A2. lastActiveProvider 当前值（通过日志推断）---")
# 最新成功的请求就是 lastActiveProvider
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=5"')
try:
    logs = json.loads(out)
    for l in logs:
        status = l.get('status_code', 0)
        if status and 200 <= status < 300:
            print(f"  最近成功请求: provider={l.get('provider_name')} | client={l.get('client_name')} | TS={l.get('timestamp')}")
            print(f"  → lastActiveProvider 应该是: {l.get('provider_name')}")
            break
except:
    print(out[:500])

print("\n--- A3. 所有 Provider 当前状态 ---")
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/providers"')
try:
    providers = json.loads(out)
    for p in providers:
        print(f"  [{p['id']}] {p['name']:25} | priority={p['priority']} | enabled={p['enabled']} | health={p['health_status']:10} | errors={p['error_count']} | exhausted={p.get('exhausted_until','None')}")
except:
    print(out[:1000])

print("\n--- A4. 所有 Client 配置 ---")
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/clients"')
try:
    clients = json.loads(out)
    for c in clients:
        po = json.loads(c.get('provider_order', '[]')) if isinstance(c.get('provider_order'), str) else c.get('provider_order', [])
        mm = c.get('model_mapping', '{}')
        print(f"  [{c['id']}] {c.get('name','?'):10} | enabled={c.get('enabled')} | default_model={c.get('default_model','None'):30} | provider_order={po} | model_mapping={mm}")
except:
    print(out[:1000])

print("\n--- A5. 请求ID 172 之后有没有新请求 ---")
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=5"')
try:
    logs = json.loads(out)
    print(f"  最新日志 ID: {logs[0]['id'] if logs else 'N/A'}")
    for l in logs[:5]:
        print(f"  ID={l['id']} TS={l['timestamp']} | {l.get('client_name','?'):10} | {l.get('provider_name',''):20} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','None')} | err={l.get('error_type','None')}")
except:
    print(out[:500])

print("\n" + "=" * 70)
print("B. Bot 状态排查")
print("=" * 70)

print("\n--- B1. 四个 bot 容器运行状态 ---")
out, _ = run_cmd_mac(PATH_PREFIX + 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" | grep -i "aling\\|arin\\|lain\\|lumi\\|openclaw"')
print(out or "(no containers found)")

print("\n--- B2. 各 bot 最近的 docker 日志（最后 20 行）---")
bots = ['aling', 'arin', 'lain', 'lumi']
for bot in bots:
    print(f"\n  === {bot.upper()} ===")
    out, _ = run_cmd_mac(PATH_PREFIX + f'docker logs --tail 30 {bot} 2>&1 | tail -20')
    # 只显示关键信息
    lines = out.strip().split('\n') if out.strip() else []
    for line in lines[-15:]:
        # 过滤掉过于冗长的行
        if len(line) > 200:
            print(f"    {line[:200]}...")
        else:
            print(f"    {line}")

print("\n--- B3. 各 bot 的 openclaw.json 模型配置 ---")
for bot in bots:
    out, _ = run_cmd_mac(PATH_PREFIX + f'docker exec {bot} cat /app/config/openclaw.json 2>/dev/null | head -50')
    if out:
        try:
            config = json.loads(out)
            model = config.get('model', config.get('llm', {}).get('model', 'N/A'))
            api_base = config.get('api_base', config.get('llm', {}).get('api_base', 'N/A'))
            print(f"  {bot.upper()}: model={model} | api_base={api_base}")
        except:
            # 可能只是部分内容，搜索关键字段
            print(f"  {bot.upper()}: (raw config excerpt)")
            for line in out.split('\n')[:10]:
                if 'model' in line.lower() or 'api' in line.lower() or 'base' in line.lower():
                    print(f"    {line.strip()}")
    else:
        print(f"  {bot.upper()}: (config not found)")

print("\n--- B4. 各 bot 的 sidecar proxy 状态 ---")
for bot in bots:
    out, _ = run_cmd_mac(PATH_PREFIX + f'docker exec {bot} ps aux 2>/dev/null | grep -i "proxy\\|node\\|api-proxy" | grep -v grep')
    if out.strip():
        print(f"  {bot.upper()}: {out.strip()}")
    else:
        out2, _ = run_cmd_mac(PATH_PREFIX + f'docker exec {bot} curl -s http://localhost:8022/health 2>/dev/null')
        print(f"  {bot.upper()}: proxy health = {out2.strip() or 'N/A'}")

print("\n--- B5. 从 bot 容器内直接测试 Gateway 连通性 ---")
# 只测试一个 bot
out, _ = run_cmd_mac(PATH_PREFIX + f'''docker exec aling curl -s -w "\\nHTTP:%{{http_code}}" -X POST http://host.docker.internal:8080/v1/messages \
  -H "x-api-key: $(docker exec aling cat /app/config/openclaw.json 2>/dev/null | grep -o '"api_key"[^,]*' | head -1 | cut -d'"' -f4)" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"messages":[{{"role":"user","content":"say ok"}}]}}' \
  --connect-timeout 5 --max-time 30 2>&1''')
print(f"  Aling -> Gateway 测试: {out[:500]}")

print("\n--- B6. Gateway server.js 进程启动时间和内存 ---")
out, _ = run_cmd_mac('ps aux | grep "node server.js" | grep -v grep')
print(f"  {out.strip()}")
out2, _ = run_cmd_mac('uptime')
print(f"  系统 uptime: {out2.strip()}")
