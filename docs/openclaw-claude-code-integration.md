# OpenClaw + Claude Code 集成指南

## 概述

本文档描述如何让 OpenClaw 机器人通过 `nodes` 工具调用宿主机或远程主机上的 Claude Code，实现自动化编程任务派发、执行和结果回传。

## 架构

```
用户 (Telegram) → OpenClaw Bot (容器内)
    ↓ nodes tool
Mac Mini / 远程主机 (宿主机)
    ↓ claude-code-dispatch.sh
Claude Code (tmux session)
    ↓ 任务完成
Hook (notify-openclaw.sh)
    ├─ Telegram Bot API → 用户收到通知
    └─ chat.inject (WebSocket) → Bot 会话历史更新
```

## 前置条件

| 组件 | 说明 |
|------|------|
| OpenClaw Gateway | 运行中的 OpenClaw 实例，带 `nodes` 工具 |
| Claude Code CLI | 目标主机上已安装 (`npm i -g @anthropic-ai/claude-code`) |
| tmux | 目标主机上已安装 |
| jq | 目标主机上已安装 |
| Node.js 22+ | 目标主机上已安装 (用于 inject.js) |

## 第一步：配置 nodes 工具

在 OpenClaw 的 `openclaw.json` 中注册目标主机：

```json
{
  "nodes": {
    "MacMini": {
      "host": "fangjin@192.168.21.111",
      "auth": "ssh-key"
    }
  }
}
```

Bot 通过 `nodes(action="run", node="MacMini", command="...")` 在目标主机上执行命令。

## 第二步：部署 Claude Code 及辅助脚本

### 2.1 Claude Code 配置

在目标主机上创建 `~/.claude/settings.json`：

```json
{
  "model": "opus",
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/notify-openclaw.sh", "timeout": 10 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/notify-openclaw.sh", "timeout": 10 }] }]
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-api-provider.com",
    "ANTHROPIC_API_KEY": "sk-xxx"
  }
}
```

### 2.2 派发脚本 (claude-code-dispatch.sh)

放置于目标主机 `~/claude-code-dispatch.sh`，核心功能：

- 接收参数：`-p "prompt"` `-n "task_name"` `-g "telegram_chat_id"` `-t max_turns` `-w workdir`
- 写入 `task-meta.json`（hook 读取 telegram_group 字段）
- 在 tmux session (`cc-TASK_NAME`) 中启动 Claude Code
- 立即返回 JSON 状态（不阻塞）

```bash
# 关键参数
-p "任务描述"          # 必填，传给 claude -p
-n "task-name"         # 任务名，用于 tmux session 命名
-g "6564284621"        # Telegram chat ID，hook 用于发送通知
-t 50                  # 最大 agent turns
-w "/path/to/workdir"  # 工作目录
```

### 2.3 状态查询脚本 (claude-code-status.sh)

```bash
# 查询任务状态
~/claude-code-status.sh -n TASK_NAME [-l 50]
# 返回: {"status": "running|completed|no_active_task", "recent_output": "..."}
```

### 2.4 停止脚本 (claude-code-stop.sh)

```bash
~/claude-code-stop.sh -n TASK_NAME   # 停止指定任务
~/claude-code-stop.sh --all          # 停止所有任务
```

## 第三步：部署完成通知 Hook

### 3.1 Hook 脚本 (notify-openclaw.sh)

放置于 `~/.claude/hooks/notify-openclaw.sh`，在 Claude Code 完成时自动触发。

核心流程：
1. 从 stdin 读取 `session_id`、`cwd`、`hook_event_name`
2. 读取任务输出（task-output.txt 或目录列表）
3. 读取 `task-meta.json` 获取 `task_name` 和 `telegram_group`
4. 写入 `latest.json`（完整结果）
5. 通过 Telegram Bot API 发送通知消息
6. 通过 `chat.inject` 将结果注入 Bot 会话历史

### 3.2 WebSocket 注入脚本 (claude-code-inject.js)

放置于 `~/claude-code-inject.js`，通过 OpenClaw Gateway 的 WebSocket API 将任务结果注入 Bot 会话。

```
用法: node inject.js <message> <sessionKey> [delayMs] [maxRetries]
```

**关键 API：`chat.inject`**

- 方法：`chat.inject`
- 参数：`{ sessionKey: "agent:main:telegram:dm:CHAT_ID", message: "..." }`
- 效果：在 Bot 的会话历史中添加一条 assistant 消息（不触发 agent run）
- 用途：让 Bot 知道任务已完成，后续对话中可引用

**Session Key 格式：**
- DM: `agent:main:telegram:dm:{chatId}`
- 群组: `agent:main:telegram:group:{chatId}`

**为什么用 `chat.inject` 而不是 `chat.send`：**

| 方法 | 行为 | messageChannel | 适用场景 |
|------|------|----------------|----------|
| `chat.send` | 发送 user 消息，触发 agent run | `webchat`（非 telegram） | 需要 agent 处理的场景 |
| `chat.inject` | 添加 assistant 消息，不触发 run | 无 | 仅更新会话历史 |

`chat.send` 的响应会路由到 `webchat` 而非 Telegram，用户看不到。`chat.inject` 直接更新历史，配合 Telegram Bot API 直接发送通知，更可靠。

### 3.3 Gateway WebSocket 认证流程

```javascript
// 1. 连接 ws://127.0.0.1:GATEWAY_PORT
// 2. 收到 connect.challenge 事件
// 3. 发送 connect 请求
ws.send(JSON.stringify({
  type: "req", id: "c1", method: "connect",
  params: {
    minProtocol: 3, maxProtocol: 3,
    client: { id: "gateway-client", version: "1.0.0", platform: "node", mode: "backend" },
    auth: { password: "GATEWAY_PASSWORD" }
  }
}));
// 4. 收到 connect 响应后，发送 chat.inject
ws.send(JSON.stringify({
  type: "req", id: "w1", method: "chat.inject",
  params: { sessionKey: "agent:main:telegram:dm:CHAT_ID", message: "任务完成通知..." }
}));
```

## 第四步：创建 OpenClaw Skill

在 Bot 的 `config/skills/claude-code/` 目录下创建：

### _meta.json

```json
{
  "slug": "claude-code",
  "name": "Claude Code (MacMini)",
  "version": "3.0.0"
}
```

### SKILL.md

Skill 文件定义 Bot 何时以及如何使用 Claude Code。关键内容：
- 触发条件（所有编程任务）
- 派发命令格式
- 状态查询方法
- 完成通知流程

详见 `config/skills/claude-code/SKILL.md`。

## 第五步：多主机扩展

要在其他主机上部署 Claude Code：

1. 在 `openclaw.json` 的 `nodes` 中注册新主机
2. 在新主机上安装 Claude Code + tmux + jq
3. 复制 dispatch/status/stop 脚本到新主机
4. 部署 hook 脚本（修改 Gateway WebSocket 地址和端口）
5. 部署 inject.js（修改 Gateway 端口）
6. 在 Skill 中添加新主机的调用方式

**注意事项：**
- inject.js 需要能连接到 Bot 所在容器的 Gateway WebSocket 端口
- 如果新主机与 Bot 不在同一网络，需要通过 VPS 代理或端口转发
- 每个主机的 `task-meta.json` 中的 `telegram_group` 决定通知发送到哪个聊天

## 故障排查

| 问题 | 检查方法 |
|------|----------|
| 任务未派发 | `nodes` 工具是否返回错误；dispatch.sh 是否有执行权限 |
| 任务完成但无通知 | 检查 hook.log: `tail -20 ~/claude-code-results/hook.log` |
| Telegram 消息未发送 | 检查 Bot Token 和 Chat ID；中国大陆需要代理 |
| chat.inject 失败 | 检查 Gateway 端口和密码；确认 sessionKey 格式正确 |
| Bot 不知道任务完成 | 用 `chat.history` API 检查会话历史中是否有注入的消息 |
| Hook 重复触发 | 正常现象，30s 去重锁会跳过重复 |

## 文件清单

| 文件 | 位置 | 用途 |
|------|------|------|
| `claude-code-dispatch.sh` | `~/` | 派发任务到 tmux |
| `claude-code-status.sh` | `~/` | 查询任务状态 |
| `claude-code-stop.sh` | `~/` | 停止任务 |
| `claude-code-inject.js` | `~/` | WebSocket 注入会话历史 |
| `notify-openclaw.sh` | `~/.claude/hooks/` | Claude Code 完成 hook |
| `settings.json` | `~/.claude/` | Claude Code 配置 + hook 注册 |
| `task-meta.json` | `$WORKDIR/` | 任务元数据（dispatch 写入，hook 读取） |
| `latest.json` | `~/claude-code-results/` | 最新完成结果 |
| `hook.log` | `~/claude-code-results/` | Hook 执行日志 |

