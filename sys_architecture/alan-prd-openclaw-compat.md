# Alan PRD — OpenClaw 兼容性

> Date: 2026-02-26
> Status: 设计讨论完成，待实现

---

## 1. 核心矛盾

OpenClaw 假设：一个 agent，一个 LLM，一次调用。
Alan 架构：一个 coordinator，两个 LLM，多步计算。

两者在 prompt 组装层冲突 — 不能让两套 prompt 组装共存（老 Metroid 的补丁地狱教训）。

## 2. 方案选择：Alan 作为 Anthropic 兼容 API Server

**替代 api-proxy.js，伪装成 Anthropic API。OpenClaw 零修改。**

```
OpenClaw pi-ai 组装 prompt → 发给 "Anthropic API"（ANTHROPIC_BASE_URL）
  → 实际发给 Alan Engine
    → 从请求中提取用户原始消息
    → 忽略 pi-ai 的 prompt 组装（浪费但无害，仅本地字符串拼接）
    → 直接读 workspace 文件（IDENTITY.md / SOUL.md / MEMORY.md）
    → 运行行为引擎（System 1 + 确定性计算）
    → 写 IMPULSE.md + internal/
    → 4 层 cache-friendly prompt 组装
    → 调 System 2（通过 LLM Gateway）
    → 返回 Anthropic 格式 response
  → pi-ai 正常处理回复
```

### 为什么选这个方案

| 优势 | 说明 |
|------|------|
| OpenClaw 零修改 | 不知道 Alan 的存在，升级不受影响 |
| 成熟模式 | api-proxy.js 拦截模式已验证 |
| 部署简单 | 改 ANTHROPIC_BASE_URL 指向 Alan 即可 |
| 工具调用兼容 | Anthropic 格式的 tool_use 自然透传 |

## 3. 三个关键行为的实现

### 3.1 已读不回

```
pi-ai 发请求 → Alan Engine 收到
  │
  ├─ 行为引擎：应该回复
  │   → 正常返回 response → pi-ai 发送 → 用户收到
  │
  └─ 行为引擎：已读不回（冲动未超阈值）
      → 内部处理（更新状态，写 IMPULSE.md）
      → 返回带 [SUPPRESS] 前缀的 response
      → 消息投递层识别 → 不发送
      → 用户收不到消息，但角色内心在挣扎
```

实现：消息投递层加 [SUPPRESS] 检测（类似现有 anthropic.js patch，改动极小）。

IMPULSE.md 在过程中被更新 — 角色的内心挣扎真实存在。
后续 heartbeat 中压抑疲劳累积到阈值时，角色才回复。

### 3.2 主动发消息

```
Heartbeat 触发 → pi-ai 发 heartbeat 消息 → Alan Engine
  → 行为引擎：时间衰减 + 冲动检查
  ├─ 超阈值 → System 2 生成主动消息 → 正常返回 → 发送
  └─ 未超阈值 → HEARTBEAT_OK → 不发送（但 IMPULSE.md 已更新）
```

零额外改动，完全复用 OpenClaw 现有 heartbeat 机制。

### 3.3 多条消息（碎片化发送）

行为引擎根据情绪状态决定消息模式：

| 状态 | 模式 | 表现 |
|------|------|------|
| 兴奋/急切 | burst | 连续 3-4 条，间隔 1-3s |
| 正常 | fragmented | 2-3 条，间隔 3-8s |
| 犹豫/紧张 | minimal | 1 条短消息 + 打字延迟 |
| 冷淡 | single | 1 条简短回复 |

实现：
```
System 2 生成带 [SPLIT] 标记的完整回复
  │
  ▼
Alan Engine 拆分：
  片段1 → 立即返回给 pi-ai → 正常发送
  片段2 → 延迟 Ns → Alan 直接调渠道 API 发送
  片段3 → 延迟 Ns → Alan 直接调渠道 API 发送
```

第一条走 pi-ai 正常流程，后续由 Alan Engine 直接投递（绕过 pi-ai 的单条限制）。

## 4. 其他兼容性细节

### 4.1 MEMORY.md 写入协调

- Alan coordinator 负责所有 MEMORY.md 写入（长期记忆巩固）
- pi-ai 的自动 MEMORY.md 写入需关闭或由 Alan 拦截统一管理
- 避免两个写入者冲突

### 4.2 工具调用

```
Alan 返回 tool_use（Anthropic 格式）
  → pi-ai 执行工具（沙箱内）
  → pi-ai 将 tool_result 发回 "Anthropic API"（Alan）
  → Alan 将 tool_result 喂给 System 2
  → System 2 继续生成回复
```

自然兼容，无需额外处理。

### 4.3 Workspace 文件访问

Alan Engine 通过文件系统直接读写 workspace（bind-mounted）：
- 读：IDENTITY.md, SOUL.md, MEMORY.md, memory.sqlite
- 写：IMPULSE.md, internal/*, MEMORY.md（巩固时）

### 4.4 OpenClaw 升级兼容

- Alan 是 Anthropic API 的 drop-in replacement
- 只要 pi-ai 还说 Anthropic 协议 → Alan 不受影响
- 风险点：workspace 文件格式变更、heartbeat 协议变更
- 缓解：升级前检查 changelog，必要时适配

## 5. OpenClaw 提供 vs Alan 提供

| OpenClaw 提供（不重写） | Alan 提供（新实现） |
|--------------------------|---------------------|
| 多渠道消息适配 | 双 LLM 架构 |
| 会话管理 | 行为引擎（四变量模型） |
| 工具调用 + 沙箱 | IMPULSE.md（内心生活） |
| Docker 部署 | World Info Engine（四信号） |
| Node 远程管理 | 4 层 cache-friendly prompt 组装 |
| heartbeat / cron / wake | 已读不回 / 多条消息 / 碎片化发送 |
| IDENTITY.md / SOUL.md | 情绪积累 / 时间感知 / 主动行为 |

## 6. 部署架构

```
Docker Container (OpenClaw Bot)
  │
  ├── openclaw-gateway (pi-ai, 渠道适配, 工具调用)
  │     │
  │     └── ANTHROPIC_BASE_URL=http://127.0.0.1:PORT
  │           │
  │           ▼
  ├── Alan Engine (替代 api-proxy.js)
  │     ├── Anthropic 兼容 API Server
  │     ├── 行为引擎 (System 1 + 确定性计算)
  │     ├── World Info Engine
  │     ├── Prompt Assembler (4 层)
  │     ├── 消息分片 + 延迟投递
  │     └── → LLM Gateway (System 2)
  │
  └── workspace/ (bind-mounted, 共享)
        ├── IDENTITY.md (pi-ai 写, Alan 读)
        ├── SOUL.md (pi-ai 写, Alan 读)
        ├── MEMORY.md (Alan coordinator 写)
        ├── memory.sqlite (Alan 读写)
        ├── IMPULSE.md (Alan coordinator 写)
        └── internal/ (Alan debug 层)
```
