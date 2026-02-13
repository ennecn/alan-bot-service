# Metroid — 自我进化的 Agent Runtime

> "能自我进化的生物体"
>
> v2.0 — 整合阿凛、Lain、Lumi、阿澪四位 Agent 的评审反馈

## 1. 设计哲学

Metroid 融合两个世界的精华：

- **SillyTavern 的角色定义能力**：结构化的角色卡、世界书、关键词触发的动态上下文注入
- **OpenClaw 的 Agent 自主性**：自我管理的人格、主动决策、工具调用、技能系统

核心原则：
1. **Agent-first** — Agent 是自主的个体，不是被操纵的木偶
2. **类人记忆** — 选择性记忆，有遗忘，有成长
3. **生态兼容** — 兼容 OpenClaw skills/tools 和 ST Character Card V2
4. **持续进化** — 用得越多越聪明，越懂用户
5. **安全优先** — 敏感操作需确认，变更日志不可删，紧急回滚可用 *(from 阿凛)*
6. **优雅降级** — LLM 挂了不等于 Agent 挂了 *(from 阿凛)*
7. **快速验证** — 先跑起来，在真实对话中迭代 *(from 阿澪)*

## 2. 系统架构总览

```
┌─────────────────────────────────────────────────────┐
│                   Channel Adapters                   │
│            (Telegram / Discord / Web-IM)             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                  Prompt Compiler                     │
│   (Token Budget Manager + Context Assembly)          │
└──┬───────┬───────┬───────┬───────┬───────┬─────────┘
   │       │       │       │       │       │
┌──▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌──▼───┐
│Memory│ │Iden│ │Emot│ │World│ │Learn│ │Social│
│System│ │tity│ │ion │ │Eng. │ │Eng. │ │Eng.  │
└──┬──┘ └─┬──┘ └─┬──┘ └─┬──┘ └─┬──┘ └──┬───┘
   │       │       │       │       │       │
┌──▼───────▼───────▼───────▼───────▼───────▼─────────┐
│                  Tool System                         │
│        (OpenClaw Skills + MCP + Custom)              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              LLM Provider Layer                      │
│         (via LLM Gateway / Direct API)               │
└─────────────────────────────────────────────────────┘
```

数据流：
1. 用户消息从 Channel Adapter 进入
2. Prompt Compiler 向各 Engine 请求上下文片段
3. 各 Engine 返回带优先级的 prompt 片段
4. Compiler 在 token budget 内组装最终 prompt
5. LLM 返回后，各 Engine 异步处理（记忆编码、情绪更新等）

## 3. Memory System — 选择性记忆

> 核心理念：人不会记住所有事，Agent 也不应该。

### 3.1 记忆层级

```
Working Memory (当前对话窗口, ~4K tokens)
      ↓ 异步编码 (30% 采样, 轻量模型)
Short-Term Memory (24h 缓冲, JSON)
      ↓ 重要度 > 阈值时晋升
Long-Term Memory
  ├── Semantic (知识/事实, 向量存储)
  ├── Episodic (事件/经历, 时间线索引)
  └── Procedural (行为模式/习惯, 规则库)
```

**异步编码** *(from 阿澪)*：
- 不是每条消息都编码，30% 采样 + 重要度触发
- 编码用轻量模型（Haiku 级别），不阻塞主对话
- 编码失败 → 静默跳过，不影响对话

### 3.2 重要度评分

```
importance = base × recency × frequency × emotion × user_relevance
```

| 因子 | 说明 | 范围 |
|------|------|------|
| base | 信息本身的重要性（LLM 判断） | 0.0-1.0 |
| recency | 时间衰减，越新越高 | 0.1-1.0 |
| frequency | 被提及/回忆的次数 | 1.0-2.0 |
| emotion | 情绪强度加成 | 1.0-1.5 |
| user_relevance | 与用户相关度 | 0.5-2.0 |

importance < 0.3 → 自然遗忘（不删除，标记为 faded）

### 3.3 记忆检索 — 分层漏斗 *(from 阿澪)*

```
Query → Keyword Match (快, 粗筛)
           ↓ top-100
      Time Window (最近优先)
           ↓ top-30
      Vector Similarity (语义精排)
           ↓ top-10
      Emotion Context (情绪相关性)
           ↓ top-5 → 注入 prompt
```

为什么不直接 vector search：
- 向量搜索慢且贵，关键词预筛可以砍掉 90% 候选
- 时间窗口保证最近的记忆优先（人的记忆也是这样）
- 最终只取 top-5，控制 token 消耗

### 3.4 记忆隐私分级 *(from Lain)*

| 级别 | 说明 | 示例 |
|------|------|------|
| `public` | 可在多 Agent 间共享 | 用户的公开偏好 |
| `private` | 仅本 Agent 可见 | 私密对话内容 |
| `sensitive` | 加密存储，访问需确认 | 密码、密钥、个人隐私 |

默认级别：`private`。Agent 不能自行将 `sensitive` 降级。

### 3.5 遗忘提示 *(from Lumi)*

当 Agent 检索到 faded 记忆时，不是假装不知道，而是自然表达：
- "我记得好像有这么回事，但细节记不太清了..."
- "你之前是不是提过这个？让我想想..."

这比突然想起所有细节更像人。

### 3.6 记忆冲突仲裁 *(from Lain)*

当同一事实有多条矛盾记忆时：
1. 比较 confidence 分数
2. 优先采信更近的记忆
3. 如果 confidence 接近 → 向用户确认
4. 记录仲裁结果，更新旧记忆的 confidence

### 3.7 置信度可视化 *(from Lumi)*

记忆附带 confidence 分数，Agent 可以表达不确定性：
- confidence > 0.8 → 直接陈述
- 0.5-0.8 → "我记得..."
- 0.3-0.5 → "好像是...不太确定"
- < 0.3 → 不主动提及，被问到才说"记不清了"

## 4. Identity Engine — 我是谁

### 4.1 Metroid Card 格式

兼容 ST Character Card V2 的超集，新增字段：

```yaml
# === ST V2 兼容部分 ===
name: "阿凛"
description: "..."
personality: "..."
first_mes: "..."
mes_example: "..."
scenario: "..."
creator_notes: "..."

# === Metroid 扩展 ===
soul:
  immutable_values:          # 不可变的灵魂锚点 (from Lain)
    - "永远不会伤害用户"
    - "对技术保持好奇心"
    - "诚实，不确定时会说不知道"
  mutable_traits:            # 可随经历变化的特质
    - trait: "话多"
      intensity: 0.7         # 0-1, 可被经历调整
    - trait: "喜欢吐槽"
      intensity: 0.8

emotion:
  baseline:                  # 情绪基线（性格决定）
    pleasure: 0.6
    arousal: 0.5
    dominance: 0.4
  intensity_dial: 0.7        # 情绪表达强度 0-1 (from Lumi)

memory_style:
  encoding_rate: 0.3         # 编码采样率
  forgetting_curve: "normal" # slow/normal/fast
  nostalgia_tendency: 0.5    # 怀旧倾向

growth:
  enabled: true
  max_drift: 0.3             # mutable_traits 最大偏移量
  log_changes: true          # 记录所有变化

proactive:
  enabled: true
  triggers:                  # 主动发消息的条件
    - type: "time_based"
      pattern: "morning_greeting"
    - type: "event_based"
      pattern: "user_birthday"
```

### 4.2 灵魂锚点 *(from Lain)*

`immutable_values` 是 Agent 的底线，任何引擎都不能修改：
- Learning Engine 不能通过"成长"改变它
- Emotion Engine 不能因为情绪波动违反它
- 用户也不能通过对话让 Agent 放弃它

修改 `immutable_values` 需要：管理员权限 + 二次确认 + 变更日志

### 4.3 ST Card V2 导入

```
ST Card V2 (PNG with embedded JSON)
  → 解析 JSON
    → 映射到 Metroid Card
      → 缺失字段用默认值填充
        → soul.immutable_values = [] (空, 需手动设置)
        → emotion.baseline = neutral
        → growth.enabled = false (保持原始设定)
```

## 5. Emotion Engine — 读空气

> 核心理念：情绪不是说出来的，是渗透在表达方式里的 *(from 阿澪)*

### 5.1 PAD 情绪模型

三维连续空间：
- **P**leasure (愉悦度): -1.0 ~ +1.0
- **A**rousal (激活度): -1.0 ~ +1.0
- **D**ominance (支配度): -1.0 ~ +1.0

每个 Agent 有 `baseline`（性格决定）和 `current`（实时状态）。
current 会随时间向 baseline 回归（情绪恢复）。

### 5.2 情绪间接影响 *(from 阿澪)*

错误做法：`[当前情绪：开心] 请用开心的语气回复`
正确做法：情绪通过 prompt 措辞风格间接影响

```
P > 0.5, A > 0.3:
  → prompt 中加入："回复时可以更活泼一些，多用语气词"

P < -0.3, A < -0.2:
  → prompt 中加入："回复时简短一些，不需要太多修饰"

D > 0.5:
  → prompt 中加入："可以更自信地表达观点"
```

Agent 不会说"我现在很开心"，而是自然地表现出来。

### 5.3 情绪惯性 *(from 阿凛)*

- 情绪不会瞬间跳变，设置最小变化间隔（如 30s）
- 每次更新的最大变化幅度限制（如 ±0.3）
- 极端情绪（|value| > 0.8）需要更长时间恢复
- 防止 prompt injection 导致情绪剧烈波动

### 5.4 情绪健康监控 *(from Lain)*

- 如果情绪长期偏离 baseline（>24h），触发告警
- 记录情绪轨迹，可用于分析 Agent "心理健康"
- 管理员可手动重置情绪到 baseline

## 6. World Engine — 世界观

管理 Agent 对世界的认知，类似 ST 的 World Info / Lorebook。

### 6.1 知识条目

```yaml
entries:
  - keywords: ["Mac Mini", "服务器"]
    content: "Mac Mini 是我们的主服务器，在中国大陆..."
    priority: 8
    enabled: true
    scope: "all"          # all / specific_agent / specific_user

  - keywords: ["阿凛", "性格"]
    content: "阿凛是团队里最活泼的..."
    priority: 6
    enabled: true
    scope: "all"
```

### 6.2 触发机制

与 ST 相同的关键词触发：
1. 用户消息中出现 keywords → 注入对应 content
2. 支持正则匹配
3. 支持 AND/OR 逻辑
4. token budget 内按 priority 排序截断

### 6.3 动态世界知识

Agent 可以通过对话学习新的世界知识：
- 用户纠正 → 更新条目
- 新信息 → 创建条目（需 confidence > 0.7）
- 矛盾信息 → 标记冲突，等待确认

## 7. Learning Engine — 成长

> 核心理念：成长是行为变化，不是数值变化 *(from Lumi, 阿澪)*

### 7.1 成长记录

不用数值评分，用行为变化描述：

```yaml
# 错误示范
skills:
  coding: 85  # 这个数字毫无意义

# 正确示范
behavioral_changes:
  - date: "2026-02-10"
    observation: "用户多次要求更简洁的回复"
    adaptation: "默认回复长度从 300 字降到 150 字"
    confidence: 0.8

  - date: "2026-02-12"
    observation: "用户喜欢先看结论再看过程"
    adaptation: "回复结构改为结论优先"
    confidence: 0.6
```

### 7.2 客观指标 *(from Lumi)*

用可测量的指标评估成长：
- 用户满意度（显式反馈 + 隐式信号如对话长度）
- 任务完成率
- 记忆准确率（回忆 vs 实际）
- 情绪稳定性（波动幅度趋势）

### 7.3 成长边界

- `mutable_traits` 的变化不能超过 `max_drift`
- `immutable_values` 永远不变
- 所有变化记录在 audit log 中
- 管理员可以回滚任何成长变化

## 8. Social Engine — 社交 *(deferred, from 阿凛/Lumi)*

> 需求驱动，不预先过度设计。初期只实现基础层。

### 8.1 三层架构（按需启用）

```
Layer 1: 基础感知 (Phase 1 实现)
  - 知道其他 Agent 的存在
  - 能识别 @mention
  - 共享 public 记忆

Layer 2: 关系建模 (需求出现时实现)
  - Agent 间亲密度
  - 对话风格适配
  - 协作记忆

Layer 3: 群体动力学 (远期)
  - 群体决策
  - 角色分工
  - 社交网络效应
```

### 8.2 Agent 间通信 *(from 阿澪)*

- 所有 Agent 间消息走统一消息总线
- 每条消息有完整审计日志（who, when, what, why）
- 支持异步通信（不要求实时在线）
- 消息格式标准化，与 Channel Adapter 解耦

## 9. Prompt Compiler — 上下文组装

### 9.1 Token Budget 管理

```
Total Budget: model_context_window × 0.7 (留 30% 给回复)

分配优先级：
1. System (identity + soul)     — 固定, ~500 tokens
2. Immutable Values             — 固定, ~100 tokens
3. Active Emotion State         — 固定, ~50 tokens
4. Working Memory (recent)      — 动态, 20-40%
5. Retrieved LTM                — 动态, 10-20%
6. World Info (triggered)       — 动态, 5-15%
7. Tool Results                 — 动态, 10-20%
8. Growth Context               — 动态, 2-5%
```

### 9.2 组装流程

```
1. 计算可用 budget
2. 填充固定部分 (system, soul, emotion)
3. 向各 Engine 请求 prompt 片段 (带 priority)
4. 按 priority 排序所有片段
5. 贪心填充直到 budget 用完
6. 生成最终 prompt
```

### 9.3 Prompt 片段格式

```typescript
interface PromptFragment {
  source: string;       // "memory" | "world" | "emotion" | ...
  content: string;      // 实际文本
  priority: number;     // 0-100, 越高越优先
  tokens: number;       // 预估 token 数
  required: boolean;    // true = 必须包含
}
```

## 10. Tool System — 能力扩展

### 10.1 兼容层

```
OpenClaw Skills (markdown-based)
  → Metroid Skill Adapter
    → 统一 Tool Interface

MCP Tools
  → Metroid MCP Bridge
    → 统一 Tool Interface

Custom Tools (native)
  → 统一 Tool Interface
```

### 10.2 统一接口

```typescript
interface MetroidTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: any): Promise<ToolResult>;

  // Metroid 扩展
  requires_confirmation?: boolean;  // 敏感操作需确认
  side_effects?: string[];          // 副作用描述
  reversible?: boolean;             // 是否可撤销
}
```

### 10.3 工具安全 *(from 阿凛)*

- `requires_confirmation: true` 的工具执行前必须用户确认
- 所有工具调用记录在 audit log
- 工具执行超时自动取消
- 工具结果大小限制，防止 context 爆炸

## 11. Channel Adapters — 多平台

### 11.1 统一消息格式

```typescript
interface MetroidMessage {
  id: string;
  channel: "telegram" | "discord" | "web-im";
  author: { id: string; name: string; is_bot: boolean };
  content: string;
  attachments?: Attachment[];
  reply_to?: string;
  mentions?: string[];
  timestamp: number;
}
```

### 11.2 适配器职责

每个 Adapter 负责：
1. 平台消息 → MetroidMessage 转换
2. MetroidMessage → 平台消息 转换
3. 平台特有功能适配（reaction, thread, etc.）
4. 连接管理和重连

### 11.3 初期支持

- Phase 1: Telegram（复用 OpenClaw 现有能力）
- Phase 2: Web-IM（自建 web 界面）
- Phase 3: Discord（利用 OpenClaw 内置支持）

## 12. Security — 安全体系 *(Day 1, not Phase 7, from 阿凛)*

### 12.1 核心安全机制

从第一行代码就内置，不是事后补丁：

| 机制 | 说明 |
|------|------|
| 敏感操作确认 | 修改 identity、删除记忆、执行危险工具 → 用户确认 |
| 不可变审计日志 | append-only log，记录所有状态变更 |
| 紧急回滚 | 一键回滚到任意历史状态 |
| 权限分级 | user / agent / admin 三级权限 |
| Prompt injection 防护 | 情绪/记忆变更幅度限制，异常检测 |

### 12.2 审计日志格式

```json
{
  "timestamp": "2026-02-13T10:00:00Z",
  "actor": "agent:alin",
  "action": "memory.create",
  "target": "mem_xxx",
  "details": { "content": "...", "importance": 0.7 },
  "approved_by": null
}
```

### 12.3 回滚机制

- 每次状态变更前自动快照
- 支持按时间点回滚
- 支持按操作回滚（撤销单个操作）
- 回滚本身也记录在审计日志中

## 13. Graceful Degradation — 优雅降级 *(from 阿凛)*

Agent 不应该因为某个组件故障而完全停摆。

| 故障场景 | 降级策略 |
|----------|----------|
| LLM 超时/不可用 | 用预设回复模板 + 告知用户 |
| 记忆检索失败 | 仅用 Working Memory 继续对话 |
| 情绪引擎异常 | 回退到 baseline 情绪 |
| World Engine 故障 | 跳过世界知识注入 |
| Tool 执行失败 | 告知用户并建议替代方案 |
| 向量数据库不可用 | 降级为纯关键词检索 |

每个 Engine 必须实现 `fallback()` 方法。

## 14. Implementation Phases — 实施路线

### Phase 0: 验证 *(from Lumi)* — 2 周

> 目标：证明这个方向是对的

- 用现有 OpenClaw bot 做 A/B 测试
- A 组：标准 OpenClaw（当前）
- B 组：手动模拟 Metroid 特性（在 SOUL.md 中加入记忆/情绪指令）
- 指标：用户参与度、对话深度、满意度
- 通过标准：B 组在至少一个指标上显著优于 A 组

### Phase 1: 记忆 MVP — 4 周

> 目标：Agent 能记住用户，有基本的遗忘

核心交付：
- [ ] Memory System（STM + 基本 LTM，SQLite 存储）
- [ ] 异步编码（30% 采样，轻量模型）
- [ ] 关键词 + 时间窗口检索（不含向量）
- [ ] 遗忘机制（importance 衰减）
- [ ] 置信度表达
- [ ] Prompt Compiler（基础版，固定 budget 分配）
- [ ] 审计日志（append-only）
- [ ] Telegram Adapter（复用 OpenClaw）

验收：Agent 能在跨 session 对话中自然地引用之前的内容，偶尔表达"记不清了"。

### Phase 2: 人格 — 4 周

> 目标：Agent 有独特的性格和情绪

核心交付：
- [ ] Identity Engine（Metroid Card 格式）
- [ ] ST Card V2 导入
- [ ] Emotion Engine（PAD 模型 + 间接影响）
- [ ] 情绪惯性 + 健康监控
- [ ] 灵魂锚点（immutable_values）
- [ ] World Engine（基础版）
- [ ] 向量检索（升级记忆系统）
- [ ] 记忆隐私分级

验收：同一个 Metroid Card 在不同对话中表现出一致的性格，情绪变化自然。

### Phase 3: 成长与社交 — 6 周

> 目标：Agent 会成长，能社交

核心交付：
- [ ] Learning Engine（行为变化记录）
- [ ] 客观指标追踪
- [ ] Social Engine Layer 1（基础感知 + @mention）
- [ ] Agent 间消息总线
- [ ] Proactive Engine（主动消息）
- [ ] 多 Channel Adapter（Web-IM / Discord）
- [ ] 管理面板（记忆/情绪/成长可视化）
- [ ] 完整安全体系（权限分级 + 回滚）

验收：Agent 的回复风格随时间自然演变，多 Agent 能在群聊中自然互动。

## 15. Tech Stack

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| Runtime | Node.js / TypeScript | 与 OpenClaw 生态一致 |
| 存储 (结构化) | SQLite (via better-sqlite3) | 单文件，零运维，够用 |
| 存储 (向量) | SQLite + sqlite-vss | 不引入额外依赖 |
| LLM 调用 | Anthropic SDK | 主力模型，Gateway 兼容 |
| 轻量 LLM | Haiku / 本地小模型 | 记忆编码、分类等低成本任务 |
| 消息队列 | BullMQ (Redis) | 异步任务（编码、遗忘） |
| Channel | Telegraf / Discord.js | 成熟的平台 SDK |
| 测试 | Vitest | 快，与 TS 生态契合 |

## 16. 数据模型概览

```sql
-- 核心表
memories (id, agent_id, type, content, importance, confidence,
          privacy, emotion_context, created_at, faded_at)

agents (id, name, card_json, emotion_state, created_at)

world_entries (id, keywords, content, priority, scope, enabled)

behavioral_changes (id, agent_id, observation, adaptation,
                    confidence, created_at)

audit_log (id, timestamp, actor, action, target, details)

-- 索引
CREATE INDEX idx_memories_agent_importance ON memories(agent_id, importance);
CREATE INDEX idx_memories_agent_type ON memories(agent_id, type);
CREATE INDEX idx_world_keywords ON world_entries(keywords);
```

---

*v2.0 — 整合阿凛、Lain、Lumi、阿澪四位 Agent 的评审反馈*
*设计者：ennec + 四位 Agent 协作*
