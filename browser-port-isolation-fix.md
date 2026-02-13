# OpenClaw Node Host 浏览器端口隔离修复

日期: 2026-02-13

## 问题现象

- 5 个 bot 中只有 Aling 能正常使用浏览器
- 其他 bot 的 node host 报错: `EADDRINUSE: address already in use 127.0.0.1:18792`
- Lumi 更严重: node host 完全无法连接 gateway (返回 404)

## 根因分析

### 端口派生公式

OpenClaw node host 的浏览器相关端口从 gateway port 派生:

```
gatewayPort  = OPENCLAW_GATEWAY_PORT 环境变量 || config.gateway.port || 18789 (默认)
controlPort  = gatewayPort + 2    (默认: 18791)
relayPort    = controlPort + 1    (默认: 18792)  ← Chrome extension relay
cdpPortStart = controlPort + 9    (默认: 18800)  ← Chrome CDP 调试端口
```

源码位置: `/opt/homebrew/lib/node_modules/openclaw/dist/server-context-BO-cIZX0.js`

### 冲突原因

所有 5 个 node host 都没有设置 `OPENCLAW_GATEWAY_PORT`，全部使用默认值 18789，
因此全部尝试绑定相同的端口:
- relay: 18792
- CDP: 18800

只有第一个启动的 node host (Aling) 成功抢到端口，其余全部失败。

### Lumi 的特殊问题

Lumi 的 Docker 端口映射是 `host:18792 → container:18789`。
Aling 的 relay 也监听在 `127.0.0.1:18792` (IPv4)。
当 Lumi 的 node host 尝试连接 `127.0.0.1:18792` 时，
命中了 Aling 的 relay (返回 404) 而非 Docker 的端口映射。

## 修复方案

给每个 node host 的 launchd plist 添加 `OPENCLAW_GATEWAY_PORT` 环境变量，
使用 19000+ 范围，间隔 100，确保派生端口互不冲突且不与 Docker 端口映射 (18789-18793) 重叠。

### 端口分配表

| Bot    | --port (gateway连接) | OPENCLAW_GATEWAY_PORT | controlPort | relayPort | cdpStart |
|--------|---------------------|-----------------------|-------------|-----------|----------|
| Alin   | 18789               | 19000                 | 19002       | 19003     | 19011    |
| Lain   | 18790               | 19100                 | 19102       | 19103     | 19111    |
| Aling  | 18791               | 19200                 | 19202       | 19203     | 19211    |
| Lumi   | 18792               | 19300                 | 19302       | 19303     | 19311    |
| Vesper | 18793               | 19400                 | 19402       | 19403     | 19411    |

### 关键发现

- `OPENCLAW_GATEWAY_PORT` 环境变量 **只影响浏览器端口派生**，不影响 `--port` CLI 参数的 gateway 连接
- 浏览器 relay 是 **懒加载** 的，只有 bot 实际请求浏览器时才会绑定端口
- launchd plist 修改后必须 `unload` + `load`，仅 `stop` + `start` 不会重新读取 plist

## 操作步骤

### 1. 修改 plist

```bash
# 对每个 bot 执行 (以 Alin 为例)
plutil -replace EnvironmentVariables.OPENCLAW_GATEWAY_PORT \
  -string '19000' \
  ~/Library/LaunchAgents/ai.openclaw.node.plist
```

### 2. 重新加载服务

```bash
# 必须 unload + load，不能只 stop + start
launchctl unload ~/Library/LaunchAgents/ai.openclaw.node.plist
sleep 2
launchctl load ~/Library/LaunchAgents/ai.openclaw.node.plist
```

### 3. 验证

```bash
# 确认环境变量生效
launchctl print gui/501/ai.openclaw.node | grep GATEWAY_PORT

# 确认 gateway 连接正常
lsof -i :18789 | grep node

# 确认无 EADDRINUSE 错误
tail -5 ~/.openclaw/logs/node-alin.err.log
```

## 验证结果

修复后:
- 5/5 node host 全部连接成功
- 0 个 EADDRINUSE 错误
- Lumi 的 gateway 连接恢复正常 (之前完全无法连接)
- 所有错误日志清空

## 新增 bot 注意事项

未来新增 bot 时，需要:
1. 选择一个未使用的 `OPENCLAW_GATEWAY_PORT` 值 (建议继续 19500, 19600...)
2. 在 launchd plist 的 `EnvironmentVariables` 中添加该值
3. 确保 `unload` + `load` 重新加载 plist
