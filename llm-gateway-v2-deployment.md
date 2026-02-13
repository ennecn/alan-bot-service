# LLM Gateway V2 部署文档

> 部署日期：2026-02-10
> 部署位置：Mac Mini (192.168.21.111)
> 管理界面：http://192.168.21.111:8080

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Mac Mini (LAN)                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  Alin    │  │  Lain    │  │  Lumi    │  │ Aling  │  │
│  │ Docker   │  │ Docker   │  │ Docker   │  │ Docker │  │
│  │ :18789   │  │ :18790   │  │ :18792   │  │ :18791 │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │              │             │      │
│       │  api-proxy (127.0.0.1:8022 容器内)        │      │
│       │  替换 x-api-key 为 gateway client key     │      │
│       └──────────────┼──────────────┼─────────────┘      │
│                      ▼              ▼                    │
│              ┌───────────────────────────┐               │
│              │   LLM Gateway V2 (:8080) │               │
│              │   路由 + 协议转换 + Web UI │               │
│              └─────┬─────────┬──────┬───┘               │
│                    │         │      │                    │
└────────────────────┼─────────┼──────┼────────────────────┘
                     │         │      │
              ┌──────┘    ┌────┘      └────────┐
              ▼           ▼                    ▼
     ┌──────────────┐ ┌──────────┐    ┌──────────────────┐
     │  Codesome    │ │  T8star  │    │  Antigravity     │
     │  Claude 4.6  │ │ Claude   │    │  VPS:8045        │
     │  Anthropic协议│ │ Anthropic│    │  OpenAI协议       │
     │  直接透传     │ │ 模型映射  │    │  Anthropic↔OpenAI │
     └──────────────┘ └──────────┘    │  + 模型映射        │
                                      │  → gemini-3-flash │
                                      └──────────────────┘
```

---

## 2. 请求流程详解

### 2.1 Codesome / T8star（Anthropic 协议，透传）

```
OpenClaw 发送:
  POST http://127.0.0.1:8022/v1/messages
  x-api-key: sk-gateway-proxy-placeholder
  body: { model: "claude-opus-4-6-20250514", tools: [...], messages: [...] }

api-proxy 转发:
  POST http://host.docker.internal:8080/v1/messages
  x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41

Gateway V2 路由:
  查 bot key → Alin → 当前 provider = codesome
  Anthropic 协议 → 直接透传（仅替换 API key 为 provider key）

发送到 Codesome:
  POST https://v3.codesome.cn/v1/messages
  x-api-key: sk-e6f7...
  body: { model: "claude-opus-4-6-20250514", ... }  # 原样
```

### 2.2 T8star（Anthropic 协议，模型名映射）

```
Gateway V2 路由:
  查 bot key → Alin → 当前 provider = t8star
  modelMap: claude-opus-4-6-20250514 → claude-opus-4-6
  body.model 替换后透传

发送到 T8star:
  POST https://ai.t8star.cn/v1/messages
  body: { model: "claude-opus-4-6", ... }  # 模型名已映射
```

### 2.3 Antigravity（OpenAI 协议，完整转换 + 模型映射）

```
Gateway V2 路由:
  查 bot key → Alin → 当前 provider = antigravity
  modelMap: claude-opus-4-6 → gemini-3-flash
  协议转换: Anthropic Messages API → OpenAI Chat Completions

转换内容:
  messages:
    - role: "user" content: [{type:"text"}] → content: "text"
    - tool_use block → tool_calls 数组
    - tool_result block → role: "tool" + tool_call_id
  tools:
    - input_schema → parameters
  tool_choice:
    - auto/any/tool → auto/required/{type:"function",...}
  stream:
    - OpenAI SSE → Anthropic SSE 实时转换

发送到 Antigravity:
  POST http://138.68.44.141:8045/v1/chat/completions
  Authorization: Bearer sk-antigravity-openclaw
  body: { model: "gemini-3-flash", tools: [...], messages: [...] }

Antigravity 内部:
  OpenAI格式 → Gemini原生API → thought_signature自动缓存/注入
```

---

## 3. 模型映射配置

| 提供商 | OpenClaw 发送 | 实际使用 | 说明 |
|--------|-------------|---------|------|
| **Codesome** | `claude-opus-4-6-20250514` | `claude-opus-4-6-20250514` | 无映射，直接透传 |
| **T8star** | `claude-opus-4-6-20250514` | `claude-opus-4-6` | T8star 不接受日期后缀 |
| **Antigravity** | `claude-opus-4-6` / `claude-opus-4-6-20250514` | `gemini-3-flash` | 映射到 Gemini 3 Flash |

Antigravity 可用的 Gemini 3 模型：
- `gemini-3-flash` — 快速模型，适合日常使用
- `gemini-3-pro` — 高质量模型
- `gemini-3-pro-image` — 支持图片生成

---

## 4. Bot 部署信息

| Bot | 容器名 | Telegram | 端口 (gateway:proxy) | Gateway Client Key |
|-----|--------|----------|---------------------|-------------------|
| Alin | `deploy-openclaw-gateway-1` | `@windclaw_bot` | 18789:8022 | `gw-alin-86f31cca5b0d93189ffca6887138ff41` |
| Lain | `lain-gateway` | `@TorrentClaw_bot` | 18790:8023 | `gw-lain-a90e1ca5a2110905fd0cb1279f74fd75` |
| Lumi | `lumi-gateway` | `@StarlightClaw_bot` | 18792:8025 | `gw-lumi-6076e75c20398d61fadace7a7c3c8b68` |
| Aling | `aling-gateway` | `@thunderopenclaw_bot` | 18791:8024 | `gw-aling-5762340acf5576d395f6cb3969c88082` |

---

## 5. 文件结构

### Gateway V2（Mac Mini）

```
/Users/fangjin/llm-gateway-v2/
├── server.js          # 核心服务（路由、协议转换、管理API）
├── config.json        # 提供商 + bot 配置（运行时可通过 Web UI 修改）
├── package.json       # 项目配置（无外部依赖，纯 Node.js 内置模块）
└── public/
    └── index.html     # Vue.js Web 管理界面
```

### 每个 Bot 容器

```
deploy[-botname]/
├── docker-compose.yml   # 容器配置（端口、环境变量、卷挂载）
├── .env                 # API_KEY + GATEWAY_TOKEN
├── api-proxy.js         # 简单转发代理（~69行，转发到 Gateway V2）
├── start.sh             # 启动脚本（monkey-patch + 启动 proxy + OpenClaw）
├── anthropic.js         # MCP tool prefix patch（挂载到容器内 pi-ai）
├── config/              # OpenClaw 配置（skills、agents 等）
└── workspace/           # OpenClaw 工作区（持久化）
```

---

## 6. 关键 Monkey-Patch

### 必须保留的（start.sh 中）

```bash
# pi-ai 库硬编码了 https://api.anthropic.com，必须重定向到本地 proxy
find /app/node_modules/.pnpm -path '*/@mariozechner/pi-ai/dist/models.generated.js' \
  -exec sed -i 's|https://api.anthropic.com|http://127.0.0.1:8022|g' {} \;
```

**原因**：pi-ai 不使用 `ANTHROPIC_BASE_URL` 环境变量，而是在 `models.generated.js` 中硬编码了 22 处 `https://api.anthropic.com`。不做此替换，请求会直接发到 api.anthropic.com 而不是经过 Gateway V2。

### 已移除的（不再需要）

```bash
# ❌ Gemini 模型替换 — Gateway V2 通过 modelMap 处理
sed -i 's|id: "gemini-3-flash-preview"|id: "gemini-3-flash"|'

# ❌ Provider 替换 — Gateway V2 处理路由
sed -i 's|provider: "github-copilot"|provider: "antigravity"|'

# ❌ API key 注入 — Gateway V2 管理所有 provider key
sed -i '/provider === "anthropic"/i if (provider === "antigravity") { return "sk-..."; }'
```

### anthropic.js 挂载（保留）

```yaml
# docker-compose.yml 中的卷挂载，用于 MCP tool prefix patch
- ./anthropic.js:/app/node_modules/.pnpm/.../providers/anthropic.js:ro
```

**原因**：OpenClaw 使用 Claude Code 订阅凭据时，需要给 tool name 加 `mcp_` 前缀以避免与 Claude Code 保留工具名冲突。

---

## 7. ANTHROPIC_API_KEY 说明

```bash
# start.sh 中设置
export ANTHROPIC_API_KEY="sk-gateway-proxy-placeholder"
```

- OpenClaw 要求 `ANTHROPIC_API_KEY` 以 `sk-` 开头才能识别为有效的 Anthropic provider
- 这个 key 是**占位符**，不是真实 API key
- `api-proxy.js` 会用自己的 `CLIENT_API_KEY`（gateway client key）替换它
- Gateway V2 根据 client key 路由，然后用 provider 的真实 API key 转发

**注意**：docker-compose 中的 `${API_KEY}` 是编译期插值（从 `.env` 文件读取），容器内不存在 `API_KEY` 环境变量。所以 start.sh 不能用 `${API_KEY}`。

---

## 8. 运维操作

### 切换 Bot 的提供商

**方式一：Web UI**
访问 http://192.168.21.111:8080，在下拉菜单中选择提供商。

**方式二：API**
```bash
curl -X PUT http://192.168.21.111:8080/api/bots/gw-alin-86f31cca5b0d93189ffca6887138ff41/provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"codesome"}'
```

### 重启 Gateway V2

```bash
launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist
launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist
```

日志位置：`/private/tmp/gateway-v2.log`

### 重启 Bot 容器

```bash
cd ~/Desktop/p/docker-openclawd/deploy      # Alin
cd ~/Desktop/p/docker-openclawd/deploy-lain  # Lain
cd ~/Desktop/p/docker-openclawd/deploy-lumi  # Lumi
cd ~/Desktop/p/docker-openclawd/deploy-aling # Aling

docker compose down && docker compose up -d
```

### 查看日志

```bash
# Gateway V2
tail -f /private/tmp/gateway-v2.log

# Bot 容器
cd ~/Desktop/p/docker-openclawd/deploy && docker compose logs -f --tail 20
```

---

## 9. 部署中踩过的坑

### 坑1：ANTHROPIC_API_KEY 格式

**现象**：`No API key found for provider "anthropic"`
**原因**：`ANTHROPIC_API_KEY=gw-alin-...` 不以 `sk-` 开头，OpenClaw 不认为是有效 key
**解决**：使用 `sk-gateway-proxy-placeholder`

### 坑2：API_KEY 环境变量不存在

**现象**：start.sh 中 `${API_KEY}` 展开为空
**原因**：docker-compose 的 `${API_KEY}` 是编译期从 `.env` 读取，不会设为容器环境变量
**解决**：不依赖 `${API_KEY}`，hardcode 或在 api-proxy.js 中 fallback

### 坑3：pi-ai 硬编码 API URL

**现象**：请求直接发到 api.anthropic.com，api-proxy 和 Gateway 无日志
**原因**：pi-ai 库在 `models.generated.js` 中硬编码了 22 处 `https://api.anthropic.com`，不使用 `ANTHROPIC_BASE_URL` 环境变量
**解决**：保留 sed monkey-patch 替换为 `http://127.0.0.1:8022`

### 坑4：Antigravity 走了 Claude 账号

**现象**：429 错误 "All accounts exhausted"，Claude 4.6 配额被消耗
**原因**：模型名 `claude-opus-4-6` 直接发给 Antigravity，它当作 Claude 模型路由到 Claude 账号
**解决**：给 Antigravity 加 modelMap，映射到 `gemini-3-flash`

### 坑5：流式响应 ERR_STREAM_WRITE_AFTER_END

**现象**：Gateway 进程在流式请求后崩溃重启
**原因**：OpenAI SSE 流结束后仍有数据写入已关闭的 response
**解决**：加 `finished` 标志，防止 `res.end()` 后继续 `res.write()`

---

## 10. Telegram 转发服务

Bot 的 Telegram API 调用通过 DNS 覆盖转发到 VPS：

```yaml
# docker-compose.yml
extra_hosts:
  - "api.telegram.org:138.68.44.141"  # VPS IP
```

VPS 上运行 TCP proxy（`telegram-proxy.js`），将 443 端口流量转发到真实的 `api.telegram.org`。这是为了绕过 Mac Mini 使用 Clash Verge 时的网络波动问题。

---

*文档版本：v1.0 | 最后更新：2026-02-10*
