## 深度调研报告：Claude Code CLI 接入 Telegram Bot

### 问题抽象
- 本质需求：CLI AI 工具 → 聊天平台桥接（Claude Code → Telegram）
- 通用程度：**高** — 已有多个开源项目解决此问题

### 发现的现有方案

| 项目/方案 | 语言 | Stars | 最后更新 | 匹配度 | 核心方式 |
|-----------|------|-------|---------|--------|---------|
| [ccbot](https://github.com/six-ddc/ccbot) | Python | 49 | 2026-02 | **高** | tmux + JSONL轮询 |
| [ccc](https://github.com/kidandcat/ccc) | Go | 27 | 2025-12 | **高** | tmux + hook回调 |
| [telecode](https://gettelecode.com/) | Python | - | 2026 | 中 | FastAPI webhook |
| [tsgram-mcp](https://github.com/areweai/tsgram-mcp) | TS/Node | 87 | 2025-01 | 低 | MCP + Docker |
| **Claude Agent SDK** | TS/Python | 官方 | 2026 | **最高** | 原生SDK调用 |

---

### 方案详细分析

#### 方案A: ccbot（最成熟的tmux方案）
```
Telegram Topic → ccbot → tmux window → Claude Code CLI
                  ↑ 轮询JSONL文件获取输出（每2秒）
```
- **亮点**: 1 Topic = 1 Window = 1 Session，交互式UI（权限确认、截图）
- **优点**: 成熟稳定，多用户支持，JSONL解析比终端解析可靠
- **缺点**: Python（用户想用Node），依赖tmux，轮询有延迟

#### 方案B: ccc（Go版tmux方案）
```
Telegram → ccc listen → tmux session → Claude Code CLI
                          ↑ hook回调发送响应
```
- **亮点**: 语音转写、大文件P2P传输、OTP权限控制
- **优点**: 单二进制部署，hook机制比轮询更实时
- **缺点**: Go（用户想用Node），单用户设计

#### 方案C: Claude Agent SDK（⭐ 推荐）
```
Telegram Bot (Node.js) → @anthropic-ai/claude-agent-sdk → Anthropic API
                          ↑ 原生TypeScript，流式输出，会话管理
```
- **npm包**: `@anthropic-ai/claude-agent-sdk`
- **核心API**:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 新会话
for await (const message of query({
  prompt: "用户消息",
  options: { allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"] }
})) {
  if ("result" in message) sendToTelegram(message.result);
}

// 续接会话（多轮对话）
for await (const message of query({
  prompt: "继续的消息",
  options: { resume: sessionId }
})) { ... }
```
- **优点**:
  - 原生TypeScript/Node.js ✅
  - 不需要tmux ✅
  - 流式输出，无需解析终端 ✅
  - 内置会话管理（resume/fork）✅
  - 内置工具（Read/Write/Edit/Bash/Glob/Grep/WebSearch）✅
  - 支持MCP、Hooks、Subagents ✅
  - 支持自定义system prompt ✅
- **需确认**: 是否支持 `ANTHROPIC_BASE_URL`（codesome.cn）

#### 方案D: CLI subprocess + stream-json（折中方案）
```
Telegram Bot (Node.js) → spawn("claude", ["-p", "--output-format", "stream-json"]) → 解析JSON流
```
- 用 `claude -p "prompt" --output-format stream-json` 获取结构化输出
- 用 `claude -r sessionId -p "prompt"` 续接会话
- **优点**: 不需要额外依赖，复用现有Claude Code安装
- **缺点**: 子进程管理复杂，不如SDK优雅

---

### 关键技术对比

| 维度 | tmux方案(ccbot/ccc) | Agent SDK | CLI subprocess |
|------|-------------------|-----------|---------------|
| 语言 | Python/Go | **TypeScript** ✅ | Node.js |
| 多轮对话 | tmux持久会话 | **SDK session resume** ✅ | --resume flag |
| 输出格式 | JSONL/终端解析 | **结构化消息流** ✅ | stream-json |
| 工具支持 | Claude Code全部 | **SDK内置全部** ✅ | Claude Code全部 |
| 部署复杂度 | 需tmux | **npm install** ✅ | 需Claude Code CLI |
| API兼容 | 用Claude Code的配置 | 需ANTHROPIC_API_KEY | 用Claude Code的配置 |
| 实时性 | 2秒轮询/hook | **流式** ✅ | 流式 |

---

### 决策建议

- [x] **推荐：Claude Agent SDK + Telegram Bot**
  - 最干净的方案，原生TypeScript，不需要tmux
  - 需要验证：codesome.cn 兼容性（ANTHROPIC_BASE_URL）
  - 如果SDK不支持自定义base URL → 退回方案D（CLI subprocess）

- [ ] **备选：CLI subprocess + stream-json**
  - 如果SDK不兼容codesome.cn，用这个
  - 复用Mac Mini上已配置好的Claude Code

- [ ] **参考但不直接用：ccbot/ccc**
  - 架构设计值得参考（Topic映射、权限UI、截图功能）
  - 但语言不匹配（Python/Go vs Node.js）

### 预估节省时间
- 如果用Agent SDK：省去tmux管理、终端解析、输出清洗，预计节省 60-70% 开发时间
- ccbot/ccc的交互设计（Topic映射、权限确认UI）可以直接借鉴
