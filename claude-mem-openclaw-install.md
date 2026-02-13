# Claude-Mem OpenClaw Plugin 安装记录

> 日期：2026-02-12
> 状态：已安装，待测试，未持久化

## 背景

OpenClaw 4 个 bot 需要跨 session 记忆能力。经过深度调研对比了 MEMORY.md、claude-mem、mem0、mcp-memory-service、memU、memory-lancedb 等方案后，选择 claude-mem 的原生 OpenClaw 插件，原因：
- claude-mem worker 已在 Mac Mini 宿主机运行（launchd 持久化）
- 有原生 OpenClaw 插件（`openclaw/` 目录）
- bot 和宿主机 Claude Code 共享同一个记忆库
- Gemini embedding 已配好，无需额外 key

## 架构

```
Bot 容器 (claude-mem OpenClaw plugin)
  → host.docker.internal:37777
    → claude-mem worker (Mac Mini 宿主机, launchd: com.claude-mem.worker)
      → SQLite + Chroma (~/.claude-mem/)
        ↕ 共享记忆池
      → 宿主机 Claude Code (claude-mem plugin)
```

## 安装步骤

### 1. 编译插件
```bash
# 在 Mac Mini 宿主机
cd ~/.claude/plugins/marketplaces/thedotmack/openclaw
npm install
npm run build
# 产出: dist/index.js
```

### 2. 复制到 4 个容器并安装
```bash
# 对每个容器执行
docker cp ~/.claude/plugins/marketplaces/thedotmack/openclaw CONTAINER:/tmp/claude-mem-plugin
docker exec CONTAINER npx openclaw plugins install /tmp/claude-mem-plugin
```

### 3. Patch worker 地址
容器内 `127.0.0.1` 无法访问宿主机，需改为 `host.docker.internal`：
```bash
docker exec CONTAINER sed -i 's/127.0.0.1/host.docker.internal/g' /home/node/.openclaw/extensions/claude-mem/dist/index.js
```

### 4. 配置 openclaw.json
在每个 bot 的 `plugins.entries` 中添加：
```json
"claude-mem": {
    "enabled": true,
    "config": {
        "workerPort": 37777,
        "project": "openclaw-{botname}",
        "syncMemoryFile": true
    }
}
```

## 当前状态

| Bot | 插件状态 | Project | Worker |
|-----|---------|---------|--------|
| 阿凛 | loaded | openclaw-alin | host.docker.internal:37777 |
| 阿澪 | loaded | openclaw-aling | host.docker.internal:37777 |
| Lain | loaded | openclaw-lain | host.docker.internal:37777 |
| Lumi | loaded | openclaw-lumi | host.docker.internal:37777 |

## 前置服务

| 服务 | 位置 | 端口 | 状态 |
|------|------|------|------|
| claude-mem worker | Mac Mini 宿主机 | 37777 | launchd 持久化 (com.claude-mem.worker) |
| Gemini Embedding | 云端 API | - | API key 已配 (AIzaSyAG15...) |

## 已知问题

1. **容器重启后 patch 丢失**：`sed` 修改的 `host.docker.internal` 在容器重启后会恢复为 `127.0.0.1`，因为 extensions 目录在容器内部
2. **持久化方案（待实施）**：将插件目录做成 bind mount，或在 startup-patch.sh 中加入 sed 命令
3. **其他 3 个 bot 缺少 memorySearch 配置**：阿澪、Lain、Lumi 没有配置 Gemini embedding 的 memorySearch（阿凛有）

## 验证命令

```bash
# 检查 worker 健康
curl -s http://localhost:37777/api/health

# 容器内检查连通性
docker exec CONTAINER curl -s http://host.docker.internal:37777/api/health

# 检查插件状态
docker exec CONTAINER npx openclaw plugins list | grep claude-mem

# 查看记忆数据
# Web UI: http://localhost:37777 (Mac Mini 本地)
```

## 相关文件

- Worker 数据: `~/.claude-mem/` (Mac Mini)
- Worker 配置: `~/.claude-mem/settings.json`
- 插件源码: `~/.claude/plugins/marketplaces/thedotmack/openclaw/`
- 安装脚本: `D:\openclawVPS\install_claude_mem.py` 等
