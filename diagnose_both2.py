#!/usr/bin/env python3
"""用正确的容器名排查 bot 状态"""
import paramiko
import json

def run_cmd_mac(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    return out, err

PATH = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; '

# 实际的容器名
containers = ['deploy-openclaw-gateway-1', 'aling-gateway', 'lain-gateway', 'lumi-gateway']

print("=" * 70)
print("1. 所有容器详细状态（含 restart count）")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\\t{{.CreatedAt}}" | grep -i "gateway\\|openclaw"')
print(out)

print("\n" + "=" * 70)
print("2. deploy-openclaw-gateway-1 是哪个 bot？（刚重启 37 分钟）")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "{{json .Config.Env}}" 2>/dev/null')
try:
    envs = json.loads(out)
    for e in envs:
        if any(k in e.lower() for k in ['bot_name', 'name', 'api_key', 'model', 'token']):
            print(f"  {e}")
except:
    print(out[:1000])

# 也看看 compose 文件
out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "{{.Config.Labels}}" 2>/dev/null')
print(f"  Labels: {out.strip()[:300]}")

print("\n" + "=" * 70)
print("3. 各容器的 openclaw 配置和 API key（用实际容器名）")
print("=" * 70)
for c in containers:
    print(f"\n  === {c} ===")
    # 尝试多个可能的配置路径
    for cfg_path in ['/app/config/openclaw.json', '/app/openclaw.json', '/config/openclaw.json', '/app/data/config.json']:
        out, _ = run_cmd_mac(PATH + f'docker exec {c} cat {cfg_path} 2>/dev/null')
        if out.strip() and not out.startswith('cat:'):
            try:
                config = json.loads(out)
                # 提取关键配置
                model = config.get('model', 'N/A')
                api_base = config.get('api_base', 'N/A')
                api_key = config.get('api_key', 'N/A')
                name = config.get('name', config.get('bot_name', 'N/A'))
                print(f"    Path: {cfg_path}")
                print(f"    name={name} | model={model}")
                print(f"    api_base={api_base}")
                print(f"    api_key={api_key[:30]}..." if len(str(api_key)) > 30 else f"    api_key={api_key}")
            except:
                print(f"    Path: {cfg_path} (not JSON)")
                for line in out.split('\n')[:5]:
                    print(f"    {line}")
            break
    else:
        # 没找到配置文件，看看容器内文件结构
        out, _ = run_cmd_mac(PATH + f'docker exec {c} ls -la /app/ 2>/dev/null')
        print(f"    /app/ contents: {out[:300]}")

print("\n" + "=" * 70)
print("4. 各容器的 sidecar proxy（api-proxy.js）配置")
print("=" * 70)
for c in containers:
    out, _ = run_cmd_mac(PATH + f'docker exec {c} cat /app/api-proxy.js 2>/dev/null | head -30')
    if out.strip():
        # 提取 Gateway URL 配置
        for line in out.split('\n'):
            if any(k in line.lower() for k in ['gateway', 'target', 'upstream', 'proxy', 'forward', 'base_url', 'api_key', '8080']):
                print(f"  {c}: {line.strip()}")
    else:
        # 看看 proxy 是怎么启动的
        out2, _ = run_cmd_mac(PATH + f'docker exec {c} ps aux 2>/dev/null | head -10')
        print(f"  {c} processes: {out2.strip()[:200]}")

print("\n" + "=" * 70)
print("5. 各容器最近日志（关注 error/timeout/retry）")
print("=" * 70)
for c in containers:
    print(f"\n  === {c} ===")
    out, _ = run_cmd_mac(PATH + f'docker logs --tail 40 {c} 2>&1 | grep -i "error\\|fail\\|timeout\\|retry\\|cascade\\|switch\\|429\\|503\\|502\\|connect" | tail -15')
    if out.strip():
        for line in out.strip().split('\n')[-10:]:
            print(f"    {line[:200]}")
    else:
        # 没有错误，显示最近几行
        out2, _ = run_cmd_mac(PATH + f'docker logs --tail 5 {c} 2>&1')
        for line in out2.strip().split('\n')[-5:]:
            print(f"    {line[:200]}")

print("\n" + "=" * 70)
print("6. deploy-openclaw-gateway-1 为什么重启了？")
print("=" * 70)
out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "RestartCount={{.RestartCount}} State={{.State.Status}} StartedAt={{.State.StartedAt}} FinishedAt={{.State.FinishedAt}} ExitCode={{.State.ExitCode}}" 2>/dev/null')
print(f"  {out.strip()}")

# 前一次的日志
out, _ = run_cmd_mac(PATH + 'docker logs --tail 50 deploy-openclaw-gateway-1 2>&1 | head -30')
print(f"\n  容器启动日志（前30行）:")
for line in out.strip().split('\n')[:20]:
    print(f"    {line[:200]}")

print("\n" + "=" * 70)
print("7. docker compose 配置文件位置和内容")
print("=" * 70)
# 找到 compose 文件
out, _ = run_cmd_mac(PATH + 'docker inspect deploy-openclaw-gateway-1 --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}" 2>/dev/null')
compose_dir = out.strip()
print(f"  Compose dir: {compose_dir}")
if compose_dir:
    out2, _ = run_cmd_mac(f'cat {compose_dir}/docker-compose.yml 2>/dev/null || cat {compose_dir}/docker-compose.yaml 2>/dev/null')
    print(out2[:2000])
