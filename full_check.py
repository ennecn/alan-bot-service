#!/usr/bin/env python3
"""全面系统检查"""
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
# 检查项 1: better-sqlite3 版本不匹配
# ============================================================
print("=" * 70)
print("[CHECK 1] better-sqlite3 版本不匹配")
print("=" * 70)

# Node 版本
out, _ = run_cmd_mac('node -v')
print(f"  系统 Node.js 版本: {out.strip()}")

out, _ = run_cmd_mac('/opt/homebrew/bin/node -v')
print(f"  Homebrew Node.js 版本: {out.strip()}")

# 哪个 node 在运行 Gateway
out, _ = run_cmd_mac('ps aux | grep "server.js" | grep -v grep')
print(f"  Gateway 进程: {out.strip()}")

out, _ = run_cmd_mac('ls -la $(which node) 2>/dev/null; which node')
print(f"  默认 node: {out.strip()}")

# better-sqlite3 编译信息
out, _ = run_cmd_mac('cat /Users/fangjin/llm-gateway/node_modules/better-sqlite3/package.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\\"version={d[\'version\']}\\") " 2>/dev/null')
print(f"  better-sqlite3: {out.strip()}")

# 检查 Gateway 是否真的能正常使用 SQLite
out, _ = run_cmd_mac('curl -s http://localhost:8080/api/providers | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\\"DB working: {len(d)} providers loaded\\")" 2>/dev/null')
print(f"  数据库状态: {out.strip()}")

# Gateway 启动方式
out, _ = run_cmd_mac('cat /proc/14726/cmdline 2>/dev/null || true')
# macOS 没有 /proc, 用另一种方式
out, _ = run_cmd_mac('lsof -p 14726 2>/dev/null | grep -E "txt|cwd|\\d+[rw]" | head -10')
print(f"  Gateway 文件句柄:")
for line in out.strip().split('\n')[:8]:
    print(f"    {line}")

# 看看 gateway 怎么启动的
out, _ = run_cmd_mac('cat /Users/fangjin/llm-gateway/start.sh 2>/dev/null || cat /Users/fangjin/llm-gateway/run.sh 2>/dev/null')
print(f"  启动脚本: {out.strip()[:500] or '(无)'}")

# ============================================================
# 检查项 2: 三个 Bot 的 fetch failed
# ============================================================
print("\n" + "=" * 70)
print("[CHECK 2] Bot 的 fetch failed 详细分析")
print("=" * 70)

bots = {
    'aling-gateway': 'Aling',
    'lain-gateway': 'Lain',
    'lumi-gateway': 'Lumi',
    'deploy-openclaw-gateway-1': 'Alin',
}

for container, name in bots.items():
    print(f"\n  --- {name} ({container}) ---")

    # fetch failed 前后上下文
    out, _ = run_cmd_mac(PATH + f'docker logs --tail 500 {container} 2>&1 | grep -B5 "fetch failed" | tail -30')
    out = out.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
    if 'fetch failed' in out:
        lines = out.strip().split('\n')
        for line in lines[-20:]:
            print(f"    {line[:200]}")
    else:
        print(f"    (无 fetch failed 错误)")

    # 检查 sidecar proxy 配置
    out, _ = run_cmd_mac(PATH + f'docker exec {container} cat /home/node/api-proxy.js 2>/dev/null | head -40')
    if out.strip():
        for line in out.strip().split('\n'):
            if any(k in line.lower() for k in ['gateway', 'target', 'upstream', 'host', 'port', '8080', 'base_url', 'proxy_to']):
                print(f"    proxy: {line.strip()}")

    # 检查容器内的环境变量
    out, _ = run_cmd_mac(PATH + f'docker exec {container} env 2>/dev/null | grep -i "ANTHROPIC\\|API_KEY\\|BASE_URL\\|GATEWAY\\|MODEL"')
    if out.strip():
        for line in out.strip().split('\n'):
            val = line.strip()
            # 隐藏长 key
            if 'KEY' in val and '=' in val:
                k, v = val.split('=', 1)
                print(f"    env: {k}={v[:25]}..." if len(v) > 25 else f"    env: {val}")
            else:
                print(f"    env: {val}")

    # 检查容器到 Gateway 的连通性
    out, _ = run_cmd_mac(PATH + f'docker exec {container} curl -s -o /dev/null -w "%{{http_code}}" http://host.docker.internal:8080/api/providers --connect-timeout 3 2>/dev/null')
    print(f"    -> Gateway 连通性: HTTP {out.strip()}")

# ============================================================
# 检查项 3: cascade 日志丢失分析
# ============================================================
print("\n" + "=" * 70)
print("[CHECK 3] Cascade 日志丢失分析")
print("=" * 70)

# 看 router.js 中 streaming cascade 的日志记录逻辑
out, _ = run_cmd_mac('sed -n "470,530p" /Users/fangjin/llm-gateway/router.js')
print("  router.js 470-530行 (streaming response + cascade 日志):")
for line in out.strip().split('\n'):
    print(f"    {line}")

# ============================================================
# 检查项 4: Gateway 运行状态
# ============================================================
print("\n" + "=" * 70)
print("[CHECK 4] Gateway 运行状态")
print("=" * 70)

# 怎么启动的 (launchctl? pm2? cron? nohup?)
out, _ = run_cmd_mac('launchctl list 2>/dev/null | grep -i "gateway\\|llm\\|node"')
print(f"  launchctl 服务: {out.strip() or '(无)'}")

out, _ = run_cmd_mac('crontab -l 2>/dev/null | grep -i "gateway\\|server"')
print(f"  crontab: {out.strip() or '(无)'}")

out, _ = run_cmd_mac('pm2 list 2>/dev/null')
print(f"  pm2: {out.strip()[:500] or '(未安装或无进程)'}")

# Gateway stdout/stderr 去哪了
out, _ = run_cmd_mac('lsof -p 14726 2>/dev/null | grep -E "^\\S+\\s+\\d+\\s+\\S+\\s+[012]"')
print(f"  Gateway 的 stdin/stdout/stderr 文件描述符:")
for line in out.strip().split('\n'):
    print(f"    {line}")

# 检查 systemd (macOS 没有，但以防万一)
# 直接看 Gateway 工作目录
out, _ = run_cmd_mac('lsof -p 14726 2>/dev/null | grep cwd')
print(f"  Gateway 工作目录: {out.strip()}")

# ============================================================
# 检查项 5: Alin 容器重启原因
# ============================================================
print("\n" + "=" * 70)
print("[CHECK 5] deploy-openclaw-gateway-1 (Alin) 重启原因")
print("=" * 70)

out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "State: {{.State.Status}}\nRestartCount: {{.RestartCount}}\nStartedAt: {{.State.StartedAt}}\nFinishedAt: {{.State.FinishedAt}}\nExitCode: {{.State.ExitCode}}\nOOMKilled: {{.State.OOMKilled}}\nRestarting: {{.RestartPolicy}}" 2>/dev/null')
print(f"  {out.strip()}")

# 看看 compose 重启策略
out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "RestartPolicy: {{.HostConfig.RestartPolicy.Name}} MaxRetry: {{.HostConfig.RestartPolicy.MaximumRetryCount}}" 2>/dev/null')
print(f"  {out.strip()}")

# 找 compose 文件
out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}" 2>/dev/null')
compose_dir = out.strip()
if not compose_dir:
    out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "{{json .Config.Labels}}" 2>/dev/null')
    try:
        labels = json.loads(out)
        compose_dir = labels.get('com.docker.compose.project.working_dir', '')
        compose_project = labels.get('com.docker.compose.project', '')
        compose_service = labels.get('com.docker.compose.service', '')
        print(f"  Compose project: {compose_project}")
        print(f"  Compose service: {compose_service}")
        print(f"  Compose dir: {compose_dir}")
    except:
        pass

if compose_dir:
    out, _ = run_cmd_mac(f'cat {compose_dir}/docker-compose.yml 2>/dev/null | head -80')
    print(f"  docker-compose.yml:")
    for line in out.strip().split('\n')[:40]:
        print(f"    {line}")

# 容器启动前的最后日志 (可能显示为什么退出)
out, _ = run_cmd_mac(PATH + 'docker logs deploy-openclaw-gateway-1 2>&1 | head -10')
out = out.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
print(f"\n  容器最初日志:")
for line in out.strip().split('\n')[:10]:
    print(f"    {line[:200]}")

# ============================================================
# 额外: 检查 WebSocket 连接问题
# ============================================================
print("\n" + "=" * 70)
print("[CHECK 6] deploy-openclaw-gateway-1 的 WebSocket 连接失败")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker logs --tail 100 deploy-openclaw-gateway-1 2>&1 | grep -c "closed before connect"')
print(f"  'closed before connect' 次数: {out.strip()}")
out, _ = run_cmd_mac(PATH + 'docker logs --tail 100 deploy-openclaw-gateway-1 2>&1 | grep -c "unauthorized"')
print(f"  'unauthorized' 次数: {out.strip()}")
out, _ = run_cmd_mac(PATH + 'docker logs --tail 100 deploy-openclaw-gateway-1 2>&1 | grep "unauthorized" | head -3')
out = out.replace('\u21c4', '<->').replace('\u2192', '->').replace('\u2190', '<-')
for line in out.strip().split('\n')[:3]:
    print(f"  {line[:200]}")
