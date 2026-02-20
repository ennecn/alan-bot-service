# ZeroClaw 对 VibeCreature / Metroid 的价值评估

**日期**: 2026-02-19
**项目**: https://github.com/zeroclaw-labs/zeroclaw
**来源**: zeroclaw-labs (Harvard/MIT/Sundai.Club 社区)
**许可**: MIT
**语言**: Rust (可选 Python companion)
**规模**: 14k stars, 1.4k forks

---

## 1. ZeroClaw 概述

ZeroClaw 是一个轻量级 AI 助手基础设施框架（<5MB RAM，<10ms 冷启动），采用 trait-based 可插拔架构。它更像是一个**轻量版 OpenClaw**，而不是 Metroid 的竞品。

### 核心特性

| 特性 | 说明 |
|------|------|
| Trait-based 架构 | Provider/Channel/Memory/Tools 全部可替换 |
| 28+ AI Provider | OpenAI, Anthropic, OpenRouter, Ollama 等 |
| 多 Channel | CLI, Telegram, Discord, Slack, Matrix, Signal, WhatsApp, Email, IRC |
| 混合记忆 | SQLite 向量(cosine) + FTS5(BM25), 可选 PostgreSQL/Lucid/Markdown |
| AIEOS 身份规范 | 结构化 AI 身份 JSON 格式 (v1.1) |
| Gateway + Daemon | webhook 服务器与自主运行时分离 |
| 记忆快照 | 自动清理 + 核心记忆导出 + 冷启动恢复 |
| 安全模型 | Pairing 配对码 + Allowlist + Workspace scoping + 加密存储 |

---

## 2. 与 Metroid 的能力对比

| 维度 | Metroid | ZeroClaw | 评价 |
|------|---------|----------|------|
| **定位** | RP 专用 Agent 运行时 | 通用 AI 助手基础设施 | 不同层面 |
| **语言** | TypeScript | Rust | 不同生态 |
| **记忆** | 向量+关键词+时间+GraphRAG+遗忘+怀旧 | 向量+FTS5 混合搜索 | Metroid 更丰富 |
| **身份** | MetroidCard (ST V2 超集) | AIEOS v1.1 JSON | 各有特色 |
| **Channel** | HTTP adapter (单一) | 10+ 平台 | ZeroClaw 更成熟 |
| **架构** | 单进程 HTTP 服务 | Gateway + Daemon 分离 | ZeroClaw 更灵活 |
| **情感** | ✅ PAD + LLM | ❌ | Metroid 独有 |
| **成长** | ✅ 行为模式检测 | ❌ | Metroid 独有 |
| **主动消息** | ✅ Impulse Accumulator | ❌ | Metroid 独有 |
| **世界书** | ✅ 完整 ST 兼容 | ❌ | Metroid 独有 |
| **rpMode** | ✅ off/sfw/nsfw | ❌ | Metroid 独有 |

---

## 3. 有价值的启发

### 3.1 AIEOS 身份规范的启发 → 定义 MetroidCard 规范

**AIEOS v1.1 结构**：

```json
{
  "identity": {
    "names": [], "bio": "", "origin": "", "residence": ""
  },
  "psychology": {
    "neural_matrix": {},
    "mbti": "",
    "ocean": { "openness": 0.8, "conscientiousness": 0.6, ... },
    "moral_compass": ""
  },
  "linguistics": {
    "text_style": "", "formality": 0.5,
    "catchphrases": [], "forbidden_words": []
  },
  "motivations": {
    "core_drive": "", "goals": { "short_term": [], "long_term": [] },
    "fears": []
  },
  "capabilities": { "skills": [], "tools": [] },
  "physicality": { "appearance": "", "avatar": "" },
  "history": { "origin_story": "", "education": "", "occupation": "" },
  "interests": { "hobbies": [], "favorites": {}, "lifestyle": "" }
}
```

**决策**：不做 AIEOS 导入兼容（项目太新，未成行业标准），但借鉴其结构化思路，**打磨 MetroidCard 自己的规范**，让其他格式导入后统一转换为 MetroidCard。

**MetroidCard 需要补充的维度**：

| 维度 | 现有 | 需新增 | 来源启发 |
|------|------|--------|---------|
| identity | ✅ name/description/personality | - | ST Card V2 |
| soul | ✅ immutable_values + mutable_traits | - | Metroid 原创 |
| emotion | ✅ PAD baseline + intensity | resilience/expressiveness/restraint 已有 | Metroid 原创 |
| memory_style | ✅ encoding_rate/forgetting_curve | - | Metroid 原创 |
| growth | ✅ enabled/max_drift | - | Metroid 原创 |
| proactive | ✅ impulse config | - | Metroid 原创 |
| rp_mode | ✅ off/sfw/nsfw | - | Metroid 原创 |
| **linguistics** | ❌ | 语言风格、口头禅、禁用词、正式度 | AIEOS |
| **motivations** | ❌ | 核心驱动力、目标、恐惧 | AIEOS |
| **physicality** | ❌ | 外貌描述、头像描述 | AIEOS + VibeCreature |
| **psychology** | 部分(PAD) | OCEAN 人格、认知风格 | AIEOS |
| **history** | 部分(scenario) | 结构化背景故事 | AIEOS |

**优先级**：与第一阶段并行，因为这是核心数据模型。

### 3.2 Gateway + Daemon 分离 → Feed 自动生成架构

**ZeroClaw 的模式**：

```
zeroclaw gateway    # webhook 服务器 (处理外部 API 请求)
zeroclaw daemon     # 自主运行时 (定时任务、主动行为)
```

两个进程独立运行，共享同一个数据目录（SQLite），通过文件锁协调。

**对 Metroid + VibeCreature 的应用**：

```
┌─────────────────────────────────────────────────┐
│                  Metroid Runtime                  │
│                                                   │
│  ┌──────────────┐     ┌──────────────────────┐  │
│  │   Gateway     │     │      Daemon           │  │
│  │  (HTTP API)   │     │  (自主运行时)          │  │
│  │               │     │                        │  │
│  │  /chat        │     │  Feed 内容生成          │  │
│  │  /agents      │     │  (定时扫描活跃 Creature │  │
│  │  /feed        │     │   → 生成文案/图片prompt │  │
│  │  /discover    │     │   → 写入 feed_posts)   │  │
│  │  /friends     │     │                        │  │
│  │               │     │  Impulse 评估           │  │
│  │  ← 同步响应   │     │  (扫描所有 agent        │  │
│  │               │     │   → 评估冲动值          │  │
│  │               │     │   → 触发主动消息)       │  │
│  │               │     │                        │  │
│  │               │     │  记忆维护               │  │
│  │               │     │  (遗忘衰减、快照导出、   │  │
│  │               │     │   GraphRAG 清理)        │  │
│  └──────┬───────┘     └──────────┬───────────┘  │
│         │                        │                │
│         └────────┬───────────────┘                │
│                  │                                 │
│         ┌────────▼────────┐                       │
│         │   SQLite DB      │                       │
│         │   (共享数据)     │                       │
│         └─────────────────┘                       │
└─────────────────────────────────────────────────┘
```

**Gateway 职责**（同步，响应外部请求）：
- 处理 Chat API 调用（用户发消息 → Creature 回复）
- Agent CRUD（创建/查询/更新/删除 Creature）
- Feed 查询和互动（获取 Feed 列表、点赞/评论/送礼）
- 好友关系管理
- 搜索/发现

**Daemon 职责**（异步，自主运行）：
- **Feed 自动生成**：定时扫描活跃 Creature，根据活跃度和发布频率规则生成内容
- **Impulse 评估**：定期评估所有 agent 的冲动值，触发主动消息
- **记忆维护**：遗忘衰减、importance 更新、快照导出、GraphRAG 清理
- **情感恢复**：PAD 状态向 baseline 自然回归
- **统计更新**：chat_count、rating 等聚合统计

**实现方式**：

```bash
# 启动 Gateway（处理 API 请求）
npx tsx src/adapter/http.ts --port 8100

# 启动 Daemon（自主运行时）
npx tsx src/daemon.ts --interval 60  # 每 60 秒扫描一次
```

两个进程共享同一个 SQLite 数据库。SQLite 支持 WAL 模式下的并发读写（一个写者 + 多个读者），Gateway 主要是读+偶尔写，Daemon 主要是读+批量写，冲突概率低。

**Daemon 扫描循环**：

```typescript
// src/daemon.ts (伪代码)
async function daemonLoop() {
  while (true) {
    const now = Date.now();

    // 1. Feed 生成
    const activeAgents = db.getActiveAgents();
    for (const agent of activeAgents) {
      if (shouldGenerateFeed(agent, now)) {
        await generateFeedPost(agent);
      }
    }

    // 2. Impulse 评估
    for (const agent of activeAgents) {
      const impulseResult = proactiveEngine.evaluate(agent, now);
      if (impulseResult.shouldFire) {
        await sendProactiveMessage(agent, impulseResult);
      }
    }

    // 3. 记忆维护
    await memoryHygiene(now);

    // 4. 情感恢复
    await emotionRecovery(now);

    await sleep(intervalMs);
  }
}
```

**优势**：
- Gateway 不被 Daemon 的批量操作阻塞
- Daemon 可以独立重启而不影响 API 服务
- 可以分别监控两个进程的健康状态
- 未来可以把 Daemon 部署到不同机器（通过 PostgreSQL 替代 SQLite）

### 3.3 记忆快照系统

**ZeroClaw 的做法**：
- 定期运行 hygiene pass（记忆清理）
- 导出核心记忆到 `MEMORY_SNAPSHOT.md`
- 冷启动时如果 DB 丢失，自动从快照恢复（"灵魂恢复"）

**对 Metroid 的应用**：

```
POST /agents/:id/snapshot/export
  → 导出 Creature 的核心记忆、情感状态、成长变化为 JSON
  → 可用于：备份、分享、迁移

POST /agents/:id/snapshot/import
  body: { snapshot: JSON }
  → 从快照恢复 Creature 状态
  → 可用于：冷启动恢复、跨服务器迁移

GET /agents/:id/snapshot
  → 查看最近的快照信息
```

**VibeCreature 应用场景**：
- 用户"分享" Creature 给朋友（导出快照 → 朋友导入）
- 服务器迁移时记忆不丢失
- 定期自动备份（Daemon 负责）

---

## 4. 不适用的部分

| ZeroClaw 特性 | 为什么不适用 |
|---|---|
| Rust 实现 | Metroid 是 TypeScript，生态不同 |
| 多 Channel 适配器 | Metroid 通过 OpenClaw bot 转发，不需要直接对接平台 |
| AIEOS 导入 | 项目太新，未成行业标准，不做兼容 |
| Composio 集成 | RP 场景不需要外部工具集成 |
| Docker sandbox | RP 场景不需要代码执行沙箱 |

---

## 5. 行动项

| 序号 | 行动 | 优先级 | 关联 |
|------|------|--------|------|
| 1 | 定义 MetroidCard 完整规范（补充 linguistics/motivations/physicality/psychology） | P0 | 与第一阶段并行 |
| 2 | 实现 Gateway + Daemon 分离架构 | P1 | 第二阶段（Feed 功能） |
| 3 | 实现记忆快照导出/导入 | P2 | 第三阶段 |
| 4 | 持续关注 AIEOS 规范发展，评估未来兼容性 | 持续 | - |

---

**文档结束**

*评估者：Claude Opus 4.6*
*评估日期：2026-02-19*
