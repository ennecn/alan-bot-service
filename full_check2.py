#!/usr/bin/env python3
"""查看 Gateway 真正的日志 + fetch failed 根因 + cascade 日志bug"""
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

# ============================================================
# Gateway 真正的日志
# ============================================================
print("=" * 70)
print("[A] Gateway 实际日志 (/private/tmp/gateway.log)")
print("=" * 70)

out, _ = run_cmd_mac('wc -l /private/tmp/gateway.log; ls -lh /private/tmp/gateway.log')
print(f"  文件信息: {out.strip()}")

print("\n  --- 最后 60 行 ---")
out, _ = run_cmd_mac('tail -60 /private/tmp/gateway.log')
for line in out.strip().split('\n'):
    print(f"  {line[:200]}")

print("\n  --- 17:26 前后的日志（cascade 发生时） ---")
out, _ = run_cmd_mac('grep -n "17:2[5-7]\\|Router\\|Fallback\\|cascade\\|error\\|fail\\|switch\\|429\\|503" /private/tmp/gateway.log | tail -40')
if out.strip():
    for line in out.strip().split('\n')[-30:]:
        print(f"  {line[:200]}")
else:
    # 可能日志格式不同，直接看时间范围
    out, _ = run_cmd_mac('grep "2026-02-09T17:2[5-8]" /private/tmp/gateway.log | tail -20')
    if out.strip():
        for line in out.strip().split('\n'):
            print(f"  {line[:200]}")
    else:
        print("  (无匹配)")

# ============================================================
# Lain 的 API key 问题!
# ============================================================
print("\n" + "=" * 70)
print("[B] Lain 的 API Key 问题!")
print("=" * 70)
print("  发现: Lain 容器的 ANTHROPIC_API_KEY=sk-dummy-key-for-lain")
print("  这不是一个有效的 Gateway 客户端 key!")
print("  Gateway 中 Lain 的 key: gw-lain-a90e1ca5a2110905fd0cb1279f74fd75")
print()

# 验证 Lain 的 proxy 是否在用正确的 key
out, _ = run_cmd_mac(PATH + 'docker exec lain-gateway cat /home/node/api-proxy.js 2>/dev/null')
if out:
    for line in out.split('\n'):
        if 'api_key' in line.lower() or 'api-key' in line.lower() or 'authorization' in line.lower() or 'x-api-key' in line.lower():
            print(f"  proxy.js: {line.strip()}")
    # 看 proxy 怎么获取 key
    for line in out.split('\n'):
        if 'ANTHROPIC' in line or 'process.env' in line or 'API_KEY' in line:
            print(f"  proxy.js: {line.strip()}")

# ============================================================
# fetch failed 的完整 stack trace
# ============================================================
print("\n" + "=" * 70)
print("[C] fetch failed 完整上下文 (Aling)")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker logs --tail 1000 aling-gateway 2>&1 | grep -B10 "fetch failed" | head -60')
out = out.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
for line in out.strip().split('\n')[:40]:
    print(f"  {line[:200]}")

# ============================================================
# 容器内的 OpenClaw 日志文件
# ============================================================
print("\n" + "=" * 70)
print("[D] 容器内 OpenClaw 详细日志")
print("=" * 70)
for c, name in [('aling-gateway', 'Aling'), ('lain-gateway', 'Lain')]:
    print(f"\n  --- {name} ---")
    out, _ = run_cmd_mac(PATH + f'docker exec {c} tail -30 /tmp/openclaw/openclaw-2026-02-09.log 2>/dev/null')
    out = out.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
    if out.strip():
        for line in out.strip().split('\n')[-15:]:
            print(f"    {line[:200]}")
    else:
        print("    (日志文件为空或不存在)")

# ============================================================
# Gateway launchctl 服务配置
# ============================================================
print("\n" + "=" * 70)
print("[E] Gateway launchctl 服务配置")
print("=" * 70)
out, _ = run_cmd_mac('cat ~/Library/LaunchAgents/com.llm-gateway.plist 2>/dev/null || cat /Library/LaunchDaemons/com.llm-gateway.plist 2>/dev/null')
if out.strip():
    for line in out.strip().split('\n'):
        print(f"  {line}")
else:
    # 搜索
    out, _ = run_cmd_mac('find ~/Library/LaunchAgents /Library/LaunchDaemons -name "*gateway*" 2>/dev/null')
    print(f"  文件搜索: {out.strip() or '(未找到)'}")
    out, _ = run_cmd_mac('launchctl print gui/$(id -u)/com.llm-gateway 2>/dev/null')
    print(f"  launchctl print: {out.strip()[:1000] or '(无信息)'}")

# ============================================================
# cascade 时 Codesome 的实际响应
# ============================================================
print("\n" + "=" * 70)
print("[F] 在 /private/tmp/gateway.log 中搜索 cascade 相关")
print("=" * 70)
out, _ = run_cmd_mac('grep -i "cascade\\|fallback\\|switch\\|codesome\\|error.*v3\\.codesome\\|timeout\\|ECONNREFUSED\\|ETIMEDOUT" /private/tmp/gateway.log | tail -30')
if out.strip():
    for line in out.strip().split('\n'):
        print(f"  {line[:200]}")
else:
    print("  (无匹配)")
    # 看全部内容
    out, _ = run_cmd_mac('wc -l /private/tmp/gateway.log')
    lines = int(out.strip().split()[0]) if out.strip() else 0
    print(f"  日志总行数: {lines}")
    if lines < 200:
        out, _ = run_cmd_mac('cat /private/tmp/gateway.log')
        for line in out.strip().split('\n'):
            print(f"  {line[:200]}")

# ============================================================
# router.js 中 streaming 失败时的 cascade 日志记录
# ============================================================
print("\n" + "=" * 70)
print("[G] router.js streaming 请求失败时的处理逻辑")
print("=" * 70)
# 看 Anthropic streaming 的失败处理
out, _ = run_cmd_mac('sed -n "610,700p" /Users/fangjin/llm-gateway/router.js')
for line in out.strip().split('\n'):
    print(f"  {line}")

# ============================================================
# Alin 的 start.sh
# ============================================================
print("\n" + "=" * 70)
print("[H] deploy-openclaw-gateway-1 的 start.sh 和 compose 目录")
print("=" * 70)
out, _ = run_cmd_mac('cat /Users/fangjin/Desktop/p/docker-openclawd/deploy/start.sh 2>/dev/null')
if out.strip():
    for line in out.strip().split('\n')[:30]:
        print(f"  {line}")
