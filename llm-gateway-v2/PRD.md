# LLM Gateway V2 — PRD

> 版本：1.0
> 日期：2026-02-10
> 状态：待确认

---

## 1. 背景与目标

### 1.1 现状问题

当前系统由多个组件拼凑而成，存在以下问题：

- **alin 的 api-proxy.js（646 行）** 内嵌了路由、级联、工具重命名、Telegram 告警等逻辑，难以维护
- **LLM Gateway V1（Mac Mini :8080）** 使用 Anthropic 入口协议，但 Anthropic→OpenAI 转换时**丢弃了 tool_use 块**，导致 Antigravity 路径的工具调用完全不可用
- **alin 的 start.sh** 用 6 个 `sed` 命令在运行时 monkey-patch OpenClaw 的内部模块，脆弱且在版本更新时易失效
- **没有统一的管理界面**，切换模型供应商需要手动改代码或配置文件
- 4 个 bot 使用不同的路由策略（alin 直连，lain/lumi/aling 走 Gateway），行为不一致

### 1.2 目标

用一个**极简、统一**的网关替换上述所有组件：

1. 所有 4 个 bot 通过同一个网关访问模型供应商
2. 提供 Web UI，可为每个 bot 独立切换模型供应商
3. 正确处理 tool use（Anthropic 格式的 `tool_use` / `tool_result`），包括转发给 Antigravity 时的完整 Anthropic↔OpenAI 格式转换
4. 代码量控制在 **单文件 ~300 行**，易于理解和维护

---

## 2. 架构

### 2.1 部署位置

**Mac Mini（192.168.21.111）**，端口 **8080**（与 V1 相同，直接替换）。

理由：
- 与 OpenClaw bot 容器在同一台机器，延迟最低
- 2/3 的 Provider（Codesome、T8star）是国内服务，Mac Mini 直连最短路径
- 只有 Antigravity 需要跨境，但无论网关在哪都避不开

### 2.2 请求流

```
Docker 容器内:
  OpenClaw Bot → [Anthropic格式] → api-proxy.js (:8022)
                                      ↓ (转发到宿主机)
Mac Mini 宿主机:
  → LLM Gateway V2 (:8080)
      ↓ (根据 API Key 查路由表)
      ├─→ Codesome    (Anthropic格式，直接透传)
      ├─→ T8star      (Anthropic格式，直接透传)
      └─→ Antigravity (Anthropic→OpenAI 转换，含完整 tool use 转换)
```

### 2.3 不变的部分

| 组件 | 说明 |
|---|---|
| 各 bot 的 `docker-compose.yml` | 不改，保持 `extra_hosts: api.telegram.org:138.68.44.141` |
| lain/lumi/aling 的 `api-proxy.js`（75 行） | 不改，已经指向 `host.docker.internal:8080` |
| Telegram DNS 劫持转发 | 不改，通过 docker extra_hosts → VPS → Telegram API |
| VPS 上的 Antigravity 容器 | 不改 |

### 2.4 需要改的部分

| 组件 | 改动 |
|---|---|
| alin 的 `api-proxy.js` | 替换为与 lain/lumi/aling 相同的简单转发版本（75 行） |
| alin 的 `start.sh` | 删除 monkey-patch 的 `sed` 命令（Gemini 相关的 hack） |
| Mac Mini 上的 LLM Gateway | 替换为 V2 |

---

## 3. 功能规格

### 3.1 代理入口

- 监听 `0.0.0.0:8080`
- 接受 `POST /v1/messages`（Anthropic Messages API 格式）
- 通过请求头 `x-api-key` 识别调用方（bot）

### 3.2 路由

- 每个 bot 用唯一的 API Key 标识（与现有 key 兼容）
- 网关维护一个 **路由表**：`API Key → Provider`
- 每个 Provider 定义：`name`、`baseUrl`、`apiKey`、`protocol`（anthropic / openai）

### 3.3 Provider 支持

| Provider | 协议 | baseUrl | 转发方式 |
|---|---|---|---|
| Codesome | anthropic | `https://v3.codesome.cn` | 直接透传（替换 `x-api-key`，原样转发 body） |
| T8star | anthropic | `https://ai.t8star.cn` | 直接透传（替换 `x-api-key`，原样转发 body） |
| Antigravity | openai | `http://138.68.44.141:8045/v1` | Anthropic→OpenAI 格式转换 |

### 3.4 Anthropic→OpenAI 格式转换（仅 Antigravity 路径需要）

#### 3.4.1 请求转换（Anthropic → OpenAI）

| Anthropic | OpenAI |
|---|---|
| `system`（字符串或数组） | `messages[0].role = "system"` |
| `messages[].role = "user"` | `messages[].role = "user"` |
| `messages[].role = "assistant"` | `messages[].role = "assistant"` |
| `content[].type = "text"` | `content` 字符串或 `{type:"text", text}` |
| `content[].type = "image"` | `{type:"image_url", image_url:{url:"data:..."}}` |
| `content[].type = "tool_use"` | `message.tool_calls[]{id, type:"function", function:{name, arguments}}` |
| `content[].type = "tool_result"` | `{role:"tool", tool_call_id, content}` |
| `tools[].input_schema` | `tools[].function.parameters`（外包 `type:"function"`） |
| `max_tokens` | `max_tokens` |
| `stream` | `stream` |
| `thinking.budget_tokens` | 不转换（Gemini 不支持 Anthropic 的 thinking 参数） |

#### 3.4.2 响应转换（OpenAI → Anthropic）

| OpenAI | Anthropic |
|---|---|
| `choices[0].message.content` | `content[].type = "text"` |
| `choices[0].message.tool_calls` | `content[].type = "tool_use"`（id, name, input） |
| `finish_reason = "stop"` | `stop_reason = "end_turn"` |
| `finish_reason = "tool_calls"` | `stop_reason = "tool_use"` |
| `finish_reason = "length"` | `stop_reason = "max_tokens"` |
| `usage.prompt_tokens` | `usage.input_tokens` |
| `usage.completion_tokens` | `usage.output_tokens` |

#### 3.4.3 流式转换（OpenAI SSE → Anthropic SSE）

| OpenAI 事件 | Anthropic 事件 |
|---|---|
| 首个 chunk | `message_start`（含 message 元数据） |
| `delta.content` | `content_block_start` + `content_block_delta`（type=text_delta） |
| `delta.tool_calls` | `content_block_start`（type=tool_use）+ `content_block_delta`（type=input_json_delta） |
| `finish_reason` | `message_delta`（含 stop_reason）+ `message_stop` |
| `[DONE]` | （已在 message_stop 中结束） |

### 3.5 Web UI

单页面管理界面，功能：

1. **Bot 列表**：显示所有已注册的 bot（名称 + API Key 前缀）
2. **Provider 切换**：为每个 bot 选择当前使用的 Provider（下拉菜单）
3. **Provider 管理**：查看/编辑 Provider 配置（name、baseUrl、apiKey、protocol）
4. **状态指示**：显示每个 Provider 的最近请求状态（成功/失败）

Web UI 内嵌在网关进程中（静态 HTML），通过 `GET /` 访问。

### 3.6 管理 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 获取完整路由配置（bots + providers） |
| PUT | `/api/bots/:key/provider` | 设置某个 bot 使用的 Provider |
| PUT | `/api/providers/:name` | 更新 Provider 配置 |
| GET | `/api/status` | 获取网关状态（各 Provider 最近状态） |

### 3.7 持久化

- 路由配置存储在 `config.json` 文件中（与网关同目录）
- 不使用数据库（SQLite 过重，JSON 文件足够）
- 每次配置变更时写盘

---

## 4. 配置格式

`config.json` 示例：

```json
{
  "providers": {
    "codesome": {
      "name": "Codesome",
      "baseUrl": "https://v3.codesome.cn",
      "apiKey": "sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8",
      "protocol": "anthropic"
    },
    "t8star": {
      "name": "T8star",
      "baseUrl": "https://ai.t8star.cn",
      "apiKey": "sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW",
      "protocol": "anthropic"
    },
    "antigravity": {
      "name": "Antigravity",
      "baseUrl": "http://138.68.44.141:8045/v1",
      "apiKey": "sk-antigravity-openclaw",
      "protocol": "openai"
    }
  },
  "bots": {
    "gw-alin-86f31cca5b0d93189ffca6887138ff41": {
      "name": "Alin",
      "provider": "t8star"
    },
    "gw-lain-a90e1ca5a2110905fd0cb1279f74fd75": {
      "name": "Lain",
      "provider": "codesome"
    },
    "gw-lumi-6076e75c20398d61fadace7a7c3c8b68": {
      "name": "Lumi",
      "provider": "codesome"
    },
    "gw-aling-5762340acf5576d395f6cb3969c88082": {
      "name": "Aling",
      "provider": "codesome"
    }
  }
}
```

---

## 5. 不包含的功能

以下功能在 V1 中存在但在 V2 中**有意省略**（简化优先）：

| 功能 | 理由 |
|---|---|
| 自动级联/故障转移 | 过度复杂，Web UI 手动切换足够 |
| 健康检查定时任务 | 不需要自动探测，看日志即可 |
| Telegram 告警通知 | 可后续按需加回，非核心 |
| 模型映射（model_mapping） | Provider 侧已有映射，网关不做二次映射 |
| 请求日志数据库 | 用 console.log 即可，输出到 launchd 日志文件 |
| API Key 轮换 | Provider 侧处理（如 Antigravity 的账号轮换） |
| SOCKS 代理支持 | 不再需要（Mac Mini 直连或通过 VPS） |

---

## 6. 迁移步骤

### 6.1 部署新网关

1. 将 `llm-gateway-v2/` 目录复制到 Mac Mini `~/llm-gateway-v2/`
2. `npm install`（仅依赖 `node-fetch`）
3. 编辑 `config.json`，确认 Provider 信息和 Bot API Key
4. 测试启动：`node server.js`

### 6.2 切换

1. 停止旧 Gateway：`launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist`
2. 更新 launchd plist 指向新路径
3. 启动新 Gateway：`launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist`

### 6.3 更新 alin

1. 替换 `deploy/api-proxy.js` 为简单转发版本
2. 更新 `deploy/.env`，设置 `API_KEY=gw-alin-86f31cca5b0d93189ffca6887138ff41`
3. 更新 `deploy/start.sh`，删除所有 `sed` monkey-patch 命令
4. 重启 alin 容器：`docker compose -f deploy/docker-compose.yml up -d`

### 6.4 验证

- 每个 bot 发送一条消息，确认能收到回复
- 通过 Web UI 切换某个 bot 的 Provider，确认切换生效
- 测试 Antigravity 路径的 tool use（发一个需要工具调用的任务）

---

## 7. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node.js (>=18) | Mac Mini 已有，与现有 Gateway 一致 |
| HTTP 框架 | 原生 `http` 模块 | 零依赖，够用 |
| HTTP 客户端 | `node-fetch` | 支持流式 |
| 持久化 | JSON 文件 | 配置简单，不需要数据库 |
| Web UI | 内嵌单页 HTML | Vue 3 CDN + Tailwind CDN，无构建步骤 |
| 进程管理 | launchd | Mac Mini 原生，已有配置 |

---

## 8. 文件结构

```
llm-gateway-v2/
├── server.js         # 主服务（代理 + 管理API + 静态文件）
├── config.json       # 路由配置（持久化）
├── package.json
└── public/
    └── index.html    # Web UI 单页面
```

---

## 9. 验收标准

1. 4 个 bot 均可通过网关正常对话（纯文本 + tool use）
2. Web UI 可查看并切换每个 bot 的 Provider
3. Antigravity 路径的 tool use 多轮对话正常工作（Anthropic↔OpenAI 完整转换）
4. Codesome / T8star 路径的 streaming 正常工作
5. `config.json` 修改后重启网关配置不丢失
6. alin 的 `start.sh` 不再包含任何 `sed` monkey-patch
