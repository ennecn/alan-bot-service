# OpenClaw 模型路由架构文档

> 最后更新: 2026-02-12 (新增 Kimi 接入, 修正路由说明)

## 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Mac Mini (192.168.21.111)                                      │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌────────┐ │
│  │ 阿凛 (Alin)  │  │ 阿澪 (Aling)│  │ Lain     │  │ Lumi   │ │
│  │ :18789       │  │ :18791       │  │ :18790   │  │ :18792 │ │
│  │ deploy-      │  │ aling-       │  │ lain-    │  │ lumi-  │ │
│  │ openclaw-    │  │ gateway      │  │ gateway  │  │ gateway│ │
│  │ gateway-1    │  │              │  │          │  │        │ │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  └───┬────┘ │
│         │                 │               │             │      │
│         │  api-proxy.js (:8022 in each container)       │      │
│         │  Anthropic格式透传, 加x-api-key               │      │
│         │                 │               │             │      │
│         ▼                 ▼               ▼             ▼      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           LLM Gateway V2 (:8080)                        │   │
│  │                                                         │   │
│  │  1. x-api-key 识别 bot                                  │   │
│  │  2. 查 bot → provider 映射                              │   │
│  │  3. 查 provider.modelMap 做模型名映射                    │   │
│  │  4. 按 provider.api 类型选择转发路径:                    │   │
│  │     - "openai": Anthropic→OpenAI 格式转换               │   │
│  │     - "anthropic": 直接透传                             │   │
│  │  5. 转发到 provider.baseUrl                             │   │
│  └────────┬──────────────┬──────────────┬──────────────────┘   │
│           │              │              │                       │
└───────────┼──────────────┼──────────────┼───────────────────────┘
            │              │              │
            ▼              ▼              ▼              ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ Kimi       │  │ Antigravity│  │ Codesome   │  │ T8star     │
   │ api.kimi   │  │ VPS:8045   │  │ v3.code-   │  │ ai.t8star  │
   │ .com/coding│  │ api=openai │  │ some.cn    │  │ .cn        │
   │ api=anthr. │  │            │  │ api=anthr. │  │ api=anthr. │
   │ ★当前使用  │  │            │  │            │  │            │
   └────────────┘  └────────────┘  └────────────┘  └────────────┘
```

## 详细请求流程 (以阿凛为例)

### 第1层: OpenClaw Agent (容器内)

- OpenClaw pi-ai 库发起 API 请求
- `models.generated.js` 被 start.sh 补丁:
  - `https://api.anthropic.com` → `http://127.0.0.1:8022`
- 请求格式: **Anthropic Messages API** (`POST /v1/messages`)
- 发送的模型名: `claude-opus-4-6` (标准 Anthropic 模型 ID)

### 第2层: api-proxy.js (容器内 :8022)

- 每个 bot 有独立的 api-proxy.js (bind-mounted :ro)
- 功能: 简单透传, 加上 bot 专属的 x-api-key
- 转发目标: `host.docker.internal:8080` (Mac Mini 的 LLM Gateway)

| Bot   | Client API Key                                    |
|-------|---------------------------------------------------|
| 阿凛  | `gw-alin-86f31cca5b0d93189ffca6887138ff41`       |
| 阿澪  | `gw-aling-5762340acf5576d395f6cb3969c88082`      |
| Lain  | `gw-lain-a90e1ca5a2110905fd0cb1279f74fd75`       |
| Lumi  | `gw-lumi-6076e75c20398d61fadace7a7c3c8b68`       |

### 第3层: LLM Gateway V2 (Mac Mini :8080)

**路由逻辑 (server.js):**

1. 从 `x-api-key` 识别 bot → `config.botKeys`
2. 查 bot 的 provider → `config.bots[botId].provider`
3. 模型名映射 → `provider.modelMap[model] || model`
4. 按 `provider.api` 分支:
   - `"openai"`: `anthropicToOpenAI()` 转换 → `POST baseUrl/v1/chat/completions`
   - `"anthropic"`: 直接透传 → `POST baseUrl/v1/messages`

**当前 Provider 配置:**

| Provider     | baseUrl                          | api       | modelMap                                    | headers |
|-------------|----------------------------------|-----------|---------------------------------------------|---------|
| kimi        | `https://api.kimi.com/coding`   | anthropic | `claude-opus-4-6` → `kimi-for-coding`      | `User-Agent: claude-code/2.1.39` |
| antigravity | `http://138.68.44.141:8045/v1`  | openai    | `claude-opus-4-6` → `gemini-3-flash`       | — |
| codesome    | `https://v3.codesome.cn/v1`     | anthropic | (无映射)                                    | — |
| t8star      | `https://ai.t8star.cn/v1`       | anthropic | `claude-opus-4-6-20250514` → `claude-opus-4-6` | — |

**当前 Bot → Provider 映射:**

| Bot   | Provider | 实际效果                                    |
|-------|---------|---------------------------------------------|
| 阿凛  | kimi    | claude-opus-4-6 → kimi-for-coding → Kimi API |
| 阿澪  | kimi    | claude-opus-4-6 → kimi-for-coding → Kimi API |
| Lain  | kimi    | claude-opus-4-6 → kimi-for-coding → Kimi API |
| Lumi  | kimi    | claude-opus-4-6 → kimi-for-coding → Kimi API |

### 第4层: Upstream Provider

**Antigravity (VPS 138.68.44.141:8045)**
- 接收 OpenAI 格式请求 (Gateway 已转换)
- 模型: `gemini-3-flash` (实际调用 Google Gemini API)
- 2个 Google 账号轮询, 3个住宅代理
- Circuit breaker 保护

**Codesome (v3.codesome.cn)**
- 接收 Anthropic 格式请求 (Gateway 直接透传)
- 模型: `claude-opus-4-6`

**T8star (ai.t8star.cn)**
- 接收 Anthropic 格式请求 (Gateway 直接透传)
- 模型: `claude-opus-4-6`

**Kimi (api.kimi.com/coding)**
- 接收 Anthropic 格式请求 (Gateway 直接透传)
- 模型: `kimi-for-coding` (256K context, reasoning, image/video)
- 需要 `User-Agent: claude-code/2.1.39` header (Gateway 已配置)
- 同时支持 OpenAI 和 Anthropic 格式 (当前用 Anthropic)
- API Key: `sk-kimi-526KDees9K4QdlMeacjrZE9wyzPXi1QQ4NqYPJ1gHW8hbqVjZoBwU8sTmbEVjZHs`

## openclaw.json 的 models.providers (重要!)

openclaw.json 中的 `models.providers` 定义了**直连**的 provider:
```json
{
  "antigravity": { "baseUrl": "http://138.68.44.141:8045/v1", "api": "openai-completions" },
  "codesome": { "baseUrl": "https://v3.codesome.cn", "api": "anthropic-messages" },
  "t8star": { "baseUrl": "https://ai.t8star.cn", "api": "anthropic-messages" }
}
```

**关键**: 当 `model.primary` 使用带 provider 前缀的模型名 (如 `antigravity/gemini-3-flash`) 时,
请求会**直连**该 provider, **完全绕过 api-proxy 和 LLM Gateway**!

只有使用不带前缀的内置 Anthropic 模型名 (如 `claude-opus-4-6`) 时,
请求才会走 `models.generated.js` 补丁路径 → api-proxy → LLM Gateway。

当前所有 4 个 bot 的 `model.primary` 已改为 `claude-opus-4-6` (无前缀), 确保走 Gateway 路由。

## Gateway 特性与限制

**支持:**
- Anthropic ↔ OpenAI 双向格式转换 (包括 tool_use, streaming)
- Gemini native tool call 解析 (`<|tool_calls_section_begin|>` 标记)
- Per-bot provider 路由
- Per-provider 模型名映射
- Per-provider 自定义 Headers (如 Kimi 的 User-Agent)
- Token 用量统计 (per bot, per model, per provider)
- Web Dashboard (http://192.168.21.111:8080)
- Telegram 通知 (provider/model 切换时自动发送, @Token_blow_zero_bot)

**不支持:**
- Provider cascade/fallback (单 provider per bot, 无自动切换)
- 请求重试

## 关键文件位置

| 文件 | 位置 |
|------|------|
| LLM Gateway server.js | `/Users/fangjin/llm-gateway-v2/server.js` |
| LLM Gateway config.json | `/Users/fangjin/llm-gateway-v2/config.json` |
| Gateway launchd plist | `~/Library/LaunchAgents/com.llm-gateway.plist` |
| Gateway 日志 | `/private/tmp/gateway-v2.log` |
| api-proxy.js (各bot) | `~/Desktop/p/docker-openclawd/{deploy}/api-proxy.js` |
| openclaw.json (各bot) | `~/Desktop/p/docker-openclawd/{deploy}/config/openclaw.json` |
| models.generated.js | 容器内 `/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_.../dist/models.generated.js` |
| start.sh (补丁+启动) | `~/Desktop/p/docker-openclawd/{deploy}/start.sh` |
