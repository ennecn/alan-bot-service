# Alan — Complete Product Requirements Document
# 一个具有情感动态的角色运行时系统

> Version: 6.0 (Fifth Red Team Reviewed)
> Date: 2026-02-26
> Status: PRD 完成，待实现
> Architecture Reference: `sys_architecture/behavioral-engine-architecture.md` (v0.2)

---

## Table of Contents

1. [产品愿景](#1-产品愿景)
2. [设计哲学](#2-设计哲学)
3. [系统架构概览](#3-系统架构概览)
4. [模块一：角色卡 & 世界书导入转换](#4-模块一角色卡--世界书导入转换)
5. [模块二：测试模块](#5-模块二测试模块)
6. [模块三：OpenClaw 兼容性](#6-模块三openclaw-兼容性)
7. [模块四：自动迭代](#7-模块四自动迭代)
8. [模块五：社交层 & 自主生活 & Action Dispatch](#8-模块五社交层--自主生活--action-dispatch)
9. [跨模块关注点](#9-跨模块关注点)
10. [实施路线图](#10-实施路线图)

---

## 1. 产品愿景

### 1.1 Alan 是什么

Alan 是一个具有情感动态的角色运行时系统。它受 OpenClaw 启发，使用全新架构，
目标是让 AI 角色拥有真正的内心生活 — 能感受时间流逝、积累情绪、主动发起对话、
选择沉默，像人一样思考和犹豫。

### 1.2 为什么重构而非迭代

老 Metroid 先实现 ST 兼容，再不断打补丁，最终架构腐化、毫无鲁棒性。
Alan 反过来走：先立架构，再逐步实现功能，兼容性是功能之一而非前提。

### 1.3 目标

- 不期望 V1 显著超越 ST
- 架构必须可迭代，总会有一个版本全方位超过 ST
- 每个版本都能方便地跟 ST 做对比测试，量化进步

### 1.4 命名

项目代号：**Alan**（致敬 Alan Turing）

### 1.5 迁移策略

从老 Metroid 迁移到 Alan：
- 现有 MEMORY.md 保留（Alan 能读，格式兼容）
- 对话历史不迁移（Alan 的 prompt 结构不同，旧历史无意义）
- IDENTITY.md / SOUL.md 由 OpenClaw 管理，不受影响
- 行为引擎状态从零开始（情绪基线、IMPULSE.md 由冷启动流程初始化）

---

## 2. 设计哲学

### 2.1 核心隐喻

人是带有认知滤镜的容器。时间流逝，外部事件流入，经过个人滤镜变成情绪，
情绪积累，超过阈值触发行为。行为改变外部世界，开启下一个循环。

### 2.2 现有系统缺什么

- **SillyTavern**：角色卡是冻结的。第 1 条消息和第 10000 条消息，角色是同一个人。World Info 只能文本匹配，无法响应情绪状态、时间条件或语义相似度。
- **OpenClaw**：workspace 文件可变，但变化是非结构化的（LLM 自由写笔记）。没有正式的情绪模型、时间计算、确定性积累。
- **共同缺陷**：LLM 永远回复。没有已读不回、犹豫数小时后才回复、打了字又删掉的概念。LLM 是三体人 — 思维即表达，没有隐藏的内心生活。

### 2.3 战略定位

不在 ST 擅长的领域竞争（正则匹配、关键词扫描、prompt 组装、可视化 UI），而是扩展 ST **架构上做不到**的事：

- 角色感受时间流逝，跨天/周发生变化
- 情绪积累跨会话、跨上下文窗口持久化
- 主动行为 — 角色自己发起联系
- 基于状态的 World Info — 条目根据情绪状态激活，不只是关键词
- 语义 World Info 匹配 — 基于含义而非精确关键词
- 消息之间存在内心生活（不只是回复时才有）

### 2.4 设计原则

1. **计算，不描述**：情绪状态由确定性引擎计算，不由 LLM 标注
2. **叙述，不参数化**：LLM 读自然语言故事，不读数值。"sadness: 0.4" 对 LLM 无意义；"心里有种说不出的沉重" 可操作
3. **单一协调器，无纠缠**：一个引擎读所有输入、计算所有状态、一次原子写入所有文件。同一 Agent 同一时间只有一个 Coordinator 实例运行（互斥锁保证）
4. **时间是力，不是标签**：时间主动变换所有状态 — 衰减、积累、截止压力、主观时长
5. **双重思维**：System 1（快速 LLM）处理直觉；System 2（强力 LLM）处理深思
6. **两层真相**：叙事内容（LLM 读，自然语言）和调试文件（人读，参数）
7. **ST 兼容为基础**：角色卡是 ST Card V2 的超集
8. **扩展，不替代**：保留 OpenClaw 的 workspace，加 IMPULSE.md + internal/ 目录和一个引擎
9. **缓存友好组装**：prompt 组件从最稳定到最不稳定排列，最大化 KV cache 命中
10. **优雅降级**：任何子系统故障不应导致完全无响应（详见 9.1 降级策略）

---

## 3. 系统架构概览

> 完整架构详见 `sys_architecture/behavioral-engine-architecture.md` (v0.2)，此处为精简版。

### 3.1 四变量模型

角色的内在状态由四个变量驱动：

| 变量 | 说明 | 示例 |
|------|------|------|
| **Time** | 时间流逝，驱动衰减和积累 | 3 小时未联系 → 思念积累 |
| **Events** | 外部事件输入 | 用户消息、heartbeat、cron、Agent 消息、社交通知、生活事件 |
| **Emotions** | 经认知滤镜处理后的情绪状态 | 开心 0.7、不安 0.3 |
| **Behavior** | 超阈值后触发的行为决策 | 回复 / 沉默 / 主动发消息 / 发朋友圈 |

循环：Time → Events → (认知滤镜) → Emotions → (阈值检查) → Behavior → 改变世界 → 下一循环

### 3.1.1 冲动计算模型

"冲动"（impulse）是行为决策的核心变量，决定角色是否回复、沉默还是犹豫。冲动值范围 [0.0, 1.0]，每次 Coordinator 运行时重新计算：

```
impulse = clamp(0, 1,
    base_impulse                          // 角色基线冲动（卡定义，默认 0.3）
  + emotion_urgency                       // 情绪紧迫度（见 3.1.2）
  + suppression_pressure                  // 压抑疲劳压力
  + time_pressure                         // 时间压力
  + event_importance                      // 事件重要度
  + user_message_increment                // 用户消息增量
)
```

各分量计算：

| 分量 | 公式 | 说明 |
|------|------|------|
| base_impulse | 卡定义值（默认 0.3） | 角色天然的主动性 |
| emotion_urgency | max(abs(emotion_deltas)) × urgency_weight | 情绪波动越大，越想表达（见 3.1.2） |
| suppression_pressure | suppression_count × 0.15 | 每次压抑（suppress 或 hesitate）累积 +0.15，reply 后归零 |
| time_pressure | sigmoid((hours_since_last - threshold) × steepness) × 0.3 | 长时间未交流 → 想说话（threshold 默认 2h，steepness 默认 1.0） |
| event_importance | System 1 输出的 event_importance × 0.2 | 重要事件推高冲动（枚举：0.0/0.3/0.6/1.0） |
| user_message_increment | 0.1 × consecutive_unreplied_messages | 用户连续未回复消息累积（+0.1/条，可配置） |

阈值检查：`impulse ≥ fire_threshold`（默认 0.6，卡可配置）→ 触发回复。详见 6.3.1 的完整决策逻辑。

**time_pressure 参考值**（steepness=1.0, threshold=2h）：1h → 0.07, 2h → 0.15, 3h → 0.21, 5h → 0.27, 8h → 0.30。

### 3.1.2 情绪计算模型

#### 情绪维度

Alan 使用 6 个基础情绪维度（角色卡可通过 `behavioral_engine.custom_emotions` 扩展）：

| 维度 | 范围 | 说明 |
|------|------|------|
| joy | [0.0, 1.0] | 快乐、满足、兴奋 |
| sadness | [0.0, 1.0] | 悲伤、失落、孤独 |
| anger | [0.0, 1.0] | 愤怒、不满、烦躁 |
| anxiety | [0.0, 1.0] | 焦虑、不安、紧张 |
| longing | [0.0, 1.0] | 思念、渴望、期待 |
| trust | [0.0, 1.0] | 信任、安全感、亲近 |

每个维度有角色卡定义的 baseline（默认 0.0），代表角色的"静息状态"。

#### 情绪更新公式

每次 Coordinator 运行时，对每个维度 d：

```
new_value[d] = clamp(0, 1,
    decayed_value[d] + system1_delta[d]
)

其中：
  decayed_value[d] = baseline[d] + (old_value[d] - baseline[d]) × decay_factor
  decay_factor = exp(-elapsed_hours / half_life[d])
  half_life[d] = 角色卡定义（默认 2.0 小时）
```

- **衰减**：情绪向 baseline 指数衰减，half_life 控制衰减速度（值越大衰减越慢）
- **System 1 delta**：System 1 输出的 emotional_interpretation，每维度 clamp ±0.3
- **最终 clamp**：确保值在 [0.0, 1.0] 范围内

#### System 1 输出到数值的映射

System 1 通过 tool_use 直接输出数值 delta（schema 强制，不需要额外映射）：

```json
{
  "emotional_interpretation": {
    "joy": +0.15,
    "anxiety": -0.05,
    "longing": +0.08
  }
}
```

未提及的维度 delta 为 0。每个 delta 在应用前 clamp 到 [-0.3, +0.3]。

#### emotion_urgency 计算（用于冲动公式）

```
emotion_urgency = max(abs(system1_delta[d]) for d in all_dimensions) × urgency_weight
urgency_weight = 1.0（默认，可配置）
```

情绪波动越剧烈，角色越想表达。

#### 情绪叙事化（数值 → 自然语言）

设计原则 2.4.2 要求"叙述，不参数化"— System 2 读自然语言，不读数值。Coordinator 在情绪计算完成后，用**确定性模板**将数值映射为自然语言片段，注入 L3 Dynamic Context：

```
模板映射规则（每个维度独立）：
  value < 0.2         → 无感知（不输出该维度）
  0.2 ≤ value < 0.4   → 轻微（"隐约有些{emotion_word}"）
  0.4 ≤ value < 0.6   → 中等（"心里{emotion_word}的感觉挺明显"）
  0.6 ≤ value < 0.8   → 强烈（"强烈的{emotion_word}涌上来"）
  value ≥ 0.8         → 极端（"{emotion_word}几乎要溢出来"）

emotion_word 由角色卡语言决定：
  joy → "开心" / "happy"
  sadness → "难过" / "sad"
  anger → "烦躁" / "frustrated"
  ...（每个维度一组多语言词表）
```

模板可通过角色卡 `behavioral_engine.emotion_templates` 自定义（如病娇角色的 anger 模板可能是"胸口像被什么堵住了"而非通用的"烦躁"）。缺失则用全局默认模板。不需要额外 LLM 调用。

### 3.2 双 LLM 架构

**模型选型**：
| 角色 | 推荐模型 | 选型标准 |
|------|----------|----------|
| System 1（直觉） | Gemini 2.0 Flash / Claude Haiku 4.5 | tool_use 可靠性 > 延迟（<1s）> 成本 |
| System 2（深思） | Claude Sonnet 4.6 / Gemini 3.1 Pro | 文笔质量 > 推理能力 > 成本 |
| Import LLM | Gemini 3.1 Flash / Claude Sonnet 4.6 | 语义理解 > 成本（一次性调用） |

所有模型通过 LLM Gateway 调用，可随时切换 provider。

System 1 通过一次结构化 mega-prompt 完成所有直觉任务（预估 ~1500 tokens 输入，~500 tokens 输出，延迟 500-800ms）。**使用 tool_use 模式**强制结构化输出（比 JSON-in-text 更可靠）：

```
System 1 mega-prompt 输入：
  ├─ 角色认知滤镜定义
  ├─ 当前情绪状态
  ├─ 事件内容（用 <<<EVENT_START_{nonce}>>> / <<<EVENT_END_{nonce}>>> 分隔符包裹，nonce 为每次调用随机生成的 8 位 hex，防用户消息伪造分隔符）
  └─ WI 候选摘要（预筛选后，≤50 条）

System 1 tool_use 输出（一次调用，通过定义 tool schema 强制结构）：
  ├─ event_classification: 事件类型和重要度（枚举值，非自由文本）
  ├─ emotional_interpretation: 情绪变化向量（各维度 clamp ±0.3，防极端跳变）
  ├─ cognitive_projection: 角色会怎么想
  ├─ wi_expansion: 额外应激活的 WI entry IDs
  ├─ impulse_narrative: 内心独白（IMPULSE.md 内容）
  └─ memory_consolidation: { should_save: boolean, summary: string }
        （判断旧 IMPULSE.md 是否值得写入 MEMORY.md，零额外 LLM 调用）

System 2（强力 LLM）：
  ├─ 生成最终回复
  ├─ 复杂推理
  ├─ 工具调用
  └─ 长文本生成
```

System 1 负责"直觉"，System 2 负责"深思"。两者由 Coordinator 编排，不直接通信。

**System 1 输出可靠性**：tool_use 模式下 LLM 被强制输出符合 schema 的 JSON。如果 tool_use 调用失败（极少数情况），降级为正则解析 text 输出；如果仍失败，使用上一次的情绪状态 + 仅 TextScanner 激活 WI（详见 9.1 降级策略）。

### 3.3 Coordinator（行为引擎）

单一协调器，一次原子操作完成所有计算。**同一 Agent 同一时间只有一个 Coordinator 实例运行**（通过互斥锁保证，后到的请求排队等待，锁超时 30s 自动释放防死锁）：

```
输入 → 获取互斥锁（30s 超时）
  → 时间计算
  → WI 预筛选（TextScanner + SemanticScorer top-K，纯确定性，不需 LLM）
  → System 1 mega-prompt（输入：事件 + 情绪 + WI 候选摘要 → 输出：分类 + 情绪解读 + WI 扩展 + 内心独白）
  → 确定性情绪计算（基于 System 1 输出 + 衰减公式）
  → 情绪叙事化（确定性模板，数值 → 自然语言片段，见 3.1.2）
  → 记忆巩固检查（System 1 memory_consolidation.should_save → memory write queue）
  → 阈值检查 + 触发源判断 → 行为决策
      │
      ├─ [suppress / hesitate] 短路路径：
      │     → IMPULSE.md 覆写 + emotion_state.md 更新
      │     → 释放互斥锁
      │     → 直接输出 Action List（无需 System 2）
      │     → Action Dispatcher
      │
      └─ [reply / proactive] 完整路径：
            → WI 最终激活（合并 TextScanner + System 1 扩展 + StateEvaluator + TemporalEvaluator）
            → IMPULSE.md 覆写 + emotion_state.md 更新
            → 4 层 Prompt 组装
            → 释放互斥锁 ← 状态计算阶段结束
            → System 2 调用（流式返回，不持锁）
            → [如 System 2 返回 tool_use] → pi-ai 执行 → tool_result 回传
              → 直接追加到当前 System 2 对话继续生成（不重新跑 Coordinator）
              → tool_use loop 最多 5 轮，超出则强制结束并返回已有文本
            → Action List → Action Dispatcher
```

**锁粒度说明**：互斥锁只保护状态计算阶段（从时间计算到 Prompt 组装）。System 2 调用在锁外执行，允许流式返回且不阻塞下一个请求的状态计算。如果 System 2 执行期间有新请求到达，新请求可以获取锁开始状态计算，但必须等前一个 System 2 完成后才能开始自己的 System 2 调用（通过 System 2 串行队列保证顺序一致性）。

**互斥锁和 System 2 串行队列均为 per-agent 粒度**（每个 Alan Engine 实例独立，不跨容器共享）。

Action Dispatcher 将类型化的行为（reply / suppress / post_moment / notify_agent 等）派发给对应的 Adapter 执行。Coordinator 不知道自己跑在什么平台上 — 脱离 OpenClaw 时只换 Adapter，Coordinator 不改。（详见模块五）

### 3.4 IMPULSE.md — 三体问题的解法

LLM 是三体人：思维即表达，无法隐藏内心。IMPULSE.md 是解法 — 在 System 2 被调用之前，Coordinator 已经写好了角色的内心独白。System 2 读到的是一个"已经在想事情"的角色，而非一张白纸。

生命周期：每次 Coordinator 运行时**覆写**（不追加）。覆写前，检查 System 1 输出的 `memory_consolidation.should_save` — 如果为 true，将 `memory_consolidation.summary` 写入 MEMORY.md（通过 memory write queue 串行化）。IMPULSE.md 只保留"此刻的内心状态"。

### 3.4.1 情绪状态持久化

情绪状态存储在 `internal/emotion_state.md`（Markdown 格式，人可读可调试）：

```markdown
# Emotion State
> Last updated: 2026-02-26T15:30:00Z
> Trigger: user_message

## Current State
- joy: 0.45 (baseline: 0.3, delta: +0.15)
- sadness: 0.05 (baseline: 0.0, delta: +0.05)
- anger: 0.00 (baseline: 0.0, delta: 0.00)
- anxiety: 0.22 (baseline: 0.1, delta: +0.12)
- longing: 0.08 (baseline: 0.0, delta: +0.08)
- trust: 0.40 (baseline: 0.3, delta: +0.10)

## Suppression Fatigue
- count: 2
- consecutive_hesitate: 1
- accumulated: 0.35
- last_suppress: 2026-02-26T15:10:00Z

## Time Anchor
- last_interaction: 2026-02-26T15:30:00Z
- session_start: 2026-02-26T14:00:00Z
```

选择 Markdown 而非数据库的理由：
- 与 workspace 其他文件（IDENTITY.md, MEMORY.md）格式一致
- 人可直接查看和手动调试
- 单 Agent 单写者，无并发问题
- 未来可迁移到 SQLite（结构化字段已定义，迁移脚本可自动转换）

**解析防御**：每次写入后立即回读验证。解析失败时 → 使用角色卡基线值重置（等同冷启动情绪状态），记录告警日志。

### 3.5 World Info Engine（四信号激活）

```
Signal 1: TextScanner（关键词/正则，确定性）
Signal 2: SemanticScorer（向量相似度，需 embedding 基础设施）
Signal 3: StateEvaluator（情绪/关系条件）
Signal 4: TemporalEvaluator（时间条件）

加权求和 → 超阈值 → 激活

默认权重：TextScanner 0.4, SemanticScorer 0.3, StateEvaluator 0.2, TemporalEvaluator 0.1
默认激活阈值：0.5
纯 ST 卡：Signal 3+4 贡献为零，权重自动重分配 → TextScanner 0.57, SemanticScorer 0.43
```

纯 ST 卡只有 Signal 1+2，Signal 3+4 自然贡献为零 — 统一管线，零模式切换。

Embedding 基础设施：导入卡时预计算所有 WI entry 的 embedding，存入 memory.sqlite。运行时只需计算当前消息的 embedding 做相似度比较。

**Embedding 服务部署**：使用硅基流动（SiliconFlow）的 `Qwen/Qwen3-Embedding-4B` 模型 API。选择 4B 而非 8B/0.6B 的理由：0.6B 跨语言能力偏弱（卡池含中日英三语），8B 对 WI 语义匹配 overkill，4B 是质量与成本的最佳平衡。

作为宿主机上的共享 HTTP 代理服务（端口 8098），所有 Agent 容器共用，统一管理 API key 和请求限流：

```
Host Machine
  └── Embedding Proxy Service (port 8098)
        ├── POST /embed  → 输入文本，调用 SiliconFlow API，返回向量
        ├── POST /batch  → 批量 embedding（导入卡时用，自动分片限流）
        └── 内置缓存：相同文本不重复调用 API（LRU, 10k entries）

Docker Containers (Agent 1, 2, ...)
  └── Alan Engine → http://host.docker.internal:8098/embed
```

**导入时 Embedding 服务不可用**：导入成功，embedding 字段标记为 `pending`。Alan Engine 内置后台定时任务（每 5 分钟，随 Engine 进程启动/停止，无需独立进程）检查 pending 项并补算。补算完成前 Signal 2 (SemanticScorer) 对该 entry 贡献为零。

### 3.6 四层 Cache-Friendly Prompt 组装

```
L1: System Prompt（角色身份 + system_prompt，几乎不变，KV cache 命中率最高）
L2: Session Context（会话内缓存：常驻 WI、SOUL.md 摘要）
L3: Dynamic Context（每轮变化：激活的 WI、IMPULSE.md、情绪叙事片段、近期社交/生活事件）
L4: Chat History + Post-History Injection
```

从最稳定到最不稳定排列，最大化 KV cache 复用。

**KV Cache 前提条件**：KV cache 复用依赖 LLM provider 支持 prompt prefix caching（如 Anthropic 的 prompt caching、OpenAI 的 automatic caching）。如果 provider 不支持，四层排列仍然有效（逻辑正确），只是不享受缓存加速。Phase 1 实现时不依赖 KV cache，作为性能优化在 provider 支持时自动生效。

Token 预算与溢出策略（详见 9.2）。

### 3.7 冷启动

新 Agent 首次启动时（无 IMPULSE.md、无情绪状态、无记忆）：

1. 导入卡时生成初始 IMPULSE.md（基于角色性格的"开场内心独白"，Import LLM 一次调用）
2. 情绪状态设为角色卡定义的基线值（缺失则用中性默认值），写入 `internal/emotion_state.md`
3. 时间锚点设为当前时间
4. 社交关系图为空（随交互自然建立）
5. 向 Event Bus 注册 Agent（status = online）

### 3.8 对话历史管理

对话历史存储在 `memory.sqlite` 的 `chat_history` 表中：

```sql
CREATE TABLE chat_history (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,      -- 会话标识
  role TEXT NOT NULL,             -- user / assistant / system
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata TEXT                   -- JSON: trigger_type, emotion_snapshot, actions 等
);
CREATE INDEX idx_session ON chat_history(session_id, timestamp);
```

生命周期：
- **写入**：每次 Coordinator 运行后，将用户消息和 Agent 回复写入
- **读取**：Coordinator 启动时加载当前 session 的最近 N 条（N 由 L4 token 预算动态决定）
- **Session 划分**：超过 4 小时无交互 → 新 session（可配置）
- **清理**：保留最近 30 天的历史，更早的自动归档到 `chat_history_archive` 表（不删除，仅不加载）

### 3.9 多用户支持

**V1 仅支持 1:1 对话**（一个 Agent 对一个人类用户）。群聊场景需要 per-user 情绪轨道和关系图，复杂度显著增加，列为 future work。

如果 Agent 被拉入群聊，行为降级为：只响应 @提及 或直接回复，忽略群内其他消息。情绪模型仍按单用户处理（群聊中所有消息视为同一"环境刺激"）。

---

## 4. 模块一：角色卡 & 世界书导入转换

### 4.1 设计原则

- **统一管线，零模式切换**：所有卡走同一条处理管线，卡的丰富度决定输出的丰富度
- **渐进增强**：纯 ST 卡导入后天然拥有基础情绪感知和语义匹配，无需卡作者额外工作
- **不追求 ST 完全一致**：目标是在新引擎上的效果，不是复刻 ST 的输出
- **重写而非复用**：老 Metroid 代码不复用，st-assembler 算法逻辑仅作参考

### 4.2 老 Metroid 失败教训

| 问题 | 后果 |
|------|------|
| World Info 导入了但运行时从未激活 | lorebook 内容对 LLM 不可见 |
| system_prompt / post_history_instructions 丢弃 | 卡的核心行为定义丢失 |
| prompt 格式不匹配（缺少 ST 标记） | LLM 看到不同结构 |
| 无 ST preset 支持 | token budget / AN depth 全忽略 |
| 先兼容 ST 再打补丁 → 架构腐化 | 系统毫无鲁棒性 |

### 4.3 解析层（Parse）

支持两种载体：PNG 文件（JSON 嵌入 tEXt chunk）和纯 JSON 文件。

提取三类数据：
- 角色定义：name, description, personality, scenario, first_mes, mes_example, alternate_greetings
- 指令层：system_prompt, post_history_instructions
- 世界书：character_book.entries[]（每条 30+ 字段）

### 4.3.1 导入 LLM 选型

角色卡导入涉及复杂的语义理解（解析角色性格、生成初始 IMPULSE.md、推断情绪基线、理解世界书条目间的关联），需要使用**较强的 LLM**：

- 推荐：Gemini 3.1 Flash 或 Claude Sonnet 4.6（平衡能力与成本）
- 导入是一次性操作，不需要极低延迟，可以用比 System 1 更强的模型
- 导入 LLM 通过 LLM Gateway 调用，与 System 1/2 共享路由基础设施

### 4.4 映射层（Map）

```
ST Card V2                              Alan 内部结构
─────────────                           ──────────────
name, description, personality      →   IDENTITY.md（角色是谁）
scenario                            →   IDENTITY.md（场景上下文）
system_prompt                       →   L1 System Prompt（最稳定层，享受 KV cache）
post_history_instructions           →   L4 Post-History Injection
first_mes + alternate_greetings     →   Greeting Pool（首条消息随机选择）
mes_example                         →   L2 Session Context（角色对话风格参考，保留 <START> 格式）
character_book.entries[]            →   World Info Engine 条目库（保留所有 30+ 字段）
extensions.behavioral_engine        →   行为引擎参数（缺失则用默认值）
其他 extensions                     →   透传存储（未来可扩展）
```

**behavioral_engine schema 版本管理**：

`extensions.behavioral_engine` 必须包含 `schema_version` 字段：

```json
{
  "schema_version": "1.0",
  "emotion_baseline": { "joy": 0.3, "anxiety": 0.1 },
  "sensitivity": { "rejection": 2.5 },
  "thresholds": { "fire": 0.3, "impulse": 0.6 }
}
```

版本兼容规则：
- `schema_version` 缺失 → 视为 `"1.0"`（向后兼容）
- 主版本号不同（如 `"2.0"` vs `"1.0"`）→ 需要迁移脚本
- 次版本号不同（如 `"1.1"` vs `"1.0"`）→ 新增字段用默认值填充

导入时同步计算所有 WI entry 的 embedding 向量，存入 memory.sqlite。

### 文件职责划分

| 文件 | 职责 | 示例（病娇角色） |
|------|------|------------------|
| IDENTITY.md | 我是谁（性格、外貌、背景） | "表面温柔体贴，内心占有欲极强" |
| SOUL.md | 我的底线（不可动摇的价值观） | "永远不会真正伤害他"、"不会放手" |
| behavioral_engine 参数 | 性格怎么运作（敏感度、阈值、衰减） | rejection_sensitivity: 2.5, fire_threshold: 0.3 |

### 4.5 激活层（Activate）— World Info Engine

统一管线（替代 ST 的递归扫描）。注意：步骤 1-2 在 System 1 调用**之前**执行（作为预筛选），步骤 3 在 System 1 调用**之中**完成，步骤 4-6 在 System 1 调用**之后**执行：

```
任何卡 → 同一条管线：

  [System 1 之前 — 预筛选阶段]
  1. TextScanner 一次扫描（关键词/正则，不递归）
     - keys / secondary_keys / selective_logic
     - AND_ANY / AND_ALL / NOT_ANY / NOT_ALL
     - regex / whole_words / case_sensitive
     - probability / enabled / constant

  2. 预筛选：TextScanner 命中 + SemanticScorer top-K → 候选集（≤50 条）
     - 超大卡（200+ entries）不会撑爆 System 1 上下文

  [System 1 之中 — 语义扩展]
  3. System 1 上下文扩展（替代 ST 递归扫描）
     - 输入：当前消息 + 已激活 entry + 候选集中未激活 entry 摘要
     - 输出：额外应激活的 entry 列表
     - 包含在 System 1 mega-prompt 中，一次调用完成

  [System 1 之后 — 最终激活]
  4. StateEvaluator（情绪/关系条件）
     - 使用 System 1 输出的情绪解读 + 确定性计算后的情绪状态
     - 纯 ST 卡无 state_conditions → 自然贡献为零

  5. TemporalEvaluator（时间条件）
     - 纯 ST 卡无 temporal_conditions → 自然贡献为零

  6. 合并所有信号 → 加权求和 → 预算管理 → 位置路由 → 注入
```

#### 为什么用 System 1 替代递归

| | ST 递归扫描 | System 1 上下文扩展 |
|---|---|---|
| 机制 | 关键词链条，逐跳匹配 | 一次 LLM 调用，语义理解 |
| 延迟 | O(N) 轮，链条越长越慢 | 包含在 System 1 mega-prompt 中 |
| 能力 | 只能沿关键词走 | 语义关联，全局视野 |
| 卡作者负担 | 需精心设计关键词链 | 无额外负担 |

#### 保留的 ST 高级机制

constant（常驻）、position（8 种注入位置）、depth（atDepth 模式）、order/weight（排序优先级）、sticky（触发后保持 N 轮）、cooldown（冷却 N 轮）、delay（前 N 轮不触发）、group（互斥组）、scan_depth（扫描深度）。

### 4.6 导入流程总览

```
ST Card V2 输入（PNG / JSON）
  │
  ▼
解析器 → 结构化数据
  │
  ▼
映射器：
  ├─ 角色定义 → IDENTITY.md
  ├─ system_prompt → L1
  ├─ post_history_instructions → L4
  ├─ greetings → Greeting Pool
  ├─ mes_example → L2 Session Context（角色对话风格参考）
  ├─ character_book → World Info Engine 条目库 + embedding 预计算
  ├─ extensions.behavioral_engine → 行为引擎参数（或默认值）
  └─ 其他 extensions → 透传存储
  │
  ▼
冷启动初始化（Import LLM 生成初始 IMPULSE.md + 推断情绪基线）
  │
  ▼
统一管线运行（TextScanner + 预筛选 + System 1 扩展 + 状态 + 时间）
```

### 4.7 语言策略

IMPULSE.md 和所有内部叙事内容跟随角色卡的主要语言生成。System 1 的 mega-prompt 使用英文（跨语言泛化能力最强），但输出的 impulse_narrative 使用角色卡语言。

---

## 5. 模块二：测试模块

### 5.1 设计原则

- **真实 ST 输出**：必须用真实运行的 ST 实例，不用模拟（之前吃过大亏）
- **目标驱动**：每次测试前设定测试目的，系统自动选卡、选模型、写 judge prompt
- **并发优先**：测试时间不能超过开发时间，必须设计并发方案
- **可迭代**：每个 Alan 版本都能方便地跑对比测试
- **分层测试**：快速验证（开发中）和完整对比（发版前）两种模式

### 5.2 测试流程总览

```
测试目标（自然语言）
  例："测试角色在长对话中是否 OOC"
  例："测试 NSFW 场景下的文笔自然度"
      │
      ▼
规划 LLM（一次调用）：
  ├─ 从 NAS 卡池索引中选择 1-N 张最合适的卡
  ├─ 设计测试场景和消息策略
  ├─ 选择驱动 LLM（Director）
  ├─ 选择 Judge LLM
  └─ 生成 Judge Prompt（针对本次目标的评判维度）
      │
      ▼
推荐列表 → 用户确认
      │
      ▼
执行器（并发）：
  ├─ Phase 1: 生成（ST 并发 + Alan 并发）
  ├─ Phase 2: 评判（Judge 完全并发）
  └─ Phase 3: 报告（HTML 生成）
```

### 5.3 快速测试模式（开发用）

完整测试流程太重，开发阶段需要轻量验证：

```
快速测试：
  - 单机运行（当前机器）
  - 单卡（手动指定或随机）
  - 3 轮对话
  - 跳过 ST 对比，只验证 Alan 自身行为
  - 检查：回复是否正常、情绪计算是否合理、WI 是否激活、IMPULSE.md 是否更新
  - 耗时：< 2 分钟
```

### 5.4 NAS 卡池

位置：`Z:\silly_tavern_世界书和角色卡\`

规模：角色卡 8635 PNG + 278 JSON = ~8913 张，世界书 144 个 JSON，30+ 类别。

需构建卡索引：扫描所有卡，提取元数据（卡名、分类、标签、description 摘要、世界书条目数、总 token 数、是否有 system_prompt、是否 NSFW、文件路径）。规划 LLM 看索引选卡，不需要读完整卡内容。

### 5.5 AI 驱动的测试规划

输入：测试目标 + 约束条件（最大卡数、轮数、NSFW 等）

规划 LLM 输出：
- 选卡列表（含选择理由）
- 场景设计（类型、轮数、轨迹、时间跳跃）
- Director 模型 + Judge 模型
- Judge 评判维度（名称、权重、描述）
- Judge Prompt

用户可确认执行、调整卡选择、修改轮数/维度、追加约束。

### 5.6 多轮对话测试 — Director 模式

核心原则：**每一轮的用户消息必须基于上一轮的真实回复生成，不能预写。**

```
Round 1: 预设开场 → ST回复 / Alan回复
Round 2: Director 读上轮回复 → 生成下一条 → ST回复 / Alan回复
Round 3: Director 读上轮回复 → 生成下一条 → ...
```

对话链策略：
- **分叉式**：ST 和 Alan 各自独立对话链，Director 分别生成消息（更公平）
- **统一式**：Director 基于参考回复生成，两边收到同样消息（更可控）

时间变量测试：Director 可插入 `[TIME_JUMP: 3 hours later]` 指令，Alan 的行为引擎处理时间衰减和积累，ST 无时间感知 — 这正是差异化优势测试点。

### 5.7 并发方案

```
Phase 1: 生成阶段
  ├─ ST: 多实例并发（Windows ST + Mac Mini ST + Linux ST）
  │   每个实例独立处理一张卡的测试
  └─ Alan: 多 agent 并发（每张卡一个 agent）

Phase 2: 评判阶段（完全并发）
  所有 (ST回复, Alan回复) 对 → 并发发给 Judge LLM

Phase 3: 报告生成（瞬时）
  汇总 → HTML
```

可用资源：Windows（当前机器）+ Mac Mini (192.168.21.111) + Linux Vesper (192.168.21.190)，3 台机器并发，测试时间压缩到 ~1/3。

### 5.8 可复用组件 vs 需新开发

**可复用**：E2E 对比框架 (st_vs_metroid_compare.py)、12 维度 Judge (judge_v2.py)、Director (director.py)、确定性测试 (deterministic-suite.py)、HTML 报告生成、压力测试套件。

**需新开发**：NAS 卡索引构建器、测试规划器、Alan HTTP API、Alan debug API、行为引擎测试场景、行为维度 judge、状态时间线可视化、并发调度器、时间跳跃支持。

---

## 6. 模块三：OpenClaw 兼容性

### 6.1 核心矛盾

OpenClaw 假设：一个 agent，一个 LLM，一次调用。
Alan 架构：一个 coordinator，两个 LLM，多步计算。

两者在 prompt 组装层冲突 — 不能让两套 prompt 组装共存（老 Metroid 的补丁地狱教训）。

### 6.2 方案：Alan 作为 Anthropic 兼容 API Server

替代 api-proxy.js，伪装成 Anthropic API。**OpenClaw 核心零修改，需少量配置调整**（诚实声明）。

```
OpenClaw pi-ai 组装 prompt → 发给 "Anthropic API"（ANTHROPIC_BASE_URL）
  → 实际发给 Alan Engine
    → 从请求中提取用户原始消息
    → 忽略 pi-ai 的 prompt 组装（浪费但无害，仅本地字符串拼接）
    → 直接读 workspace 文件（IDENTITY.md / SOUL.md / MEMORY.md）
    → 运行行为引擎（System 1 + 确定性计算）
    → 覆写 IMPULSE.md + internal/
    → 4 层 cache-friendly prompt 组装
    → 调 System 2（通过 LLM Gateway）
    → 返回 Anthropic 格式 response（支持 SSE 流式）
  → pi-ai 正常处理回复
```

**响应格式**：Alan Engine 必须支持 Anthropic SSE 流式响应格式（`text/event-stream`），因为 pi-ai 默认使用流式请求。每个 SSE event 遵循 Anthropic 的 `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_stop` 事件序列。非流式请求（`stream: false`）同样支持。

需要的配置调整（非代码修改）：
- `ANTHROPIC_BASE_URL` 指向 Alan Engine
- 关闭 pi-ai 的自动 MEMORY.md 写入（openclaw.json 配置项）
- 如无法关闭：Alan 在 API 层拦截 MEMORY.md 相关的 tool_use 请求

**用户原始消息提取策略**：

pi-ai 发来的是完整组装后的 Anthropic messages 数组，Alan 需要从中提取用户刚发的消息：

```
提取策略（按优先级）：
  1. 取 messages 数组中最后一条 role: "user" 的 content
  2. 健壮性检查：如果最后一条 user message 看起来像系统指令（长度 > 2000 tokens
     或包含已知 pi-ai 模板标记）→ 向前搜索，取倒数第二条 user message
  3. 兜底：如果提取失败，将整个最后一条 user message 作为输入（可能包含 pi-ai 注入
     的上下文，但不会导致错误，只是 System 1 的输入略冗余）
```

此策略对 pi-ai 的 prompt 格式变化有一定容错。如果 OpenClaw 升级导致提取失败率上升，metrics.jsonl 中的 `extraction_fallback: true` 字段会告警。

### 6.3 三个关键行为（统一通过 Action Dispatch 实现）

所有行为通过 Action List 表达，不使用文本前缀。OpenClaw 模式下，Action Dispatcher 的 DeliveryAdapter 负责翻译为 Anthropic response 格式。

#### 6.3.1 已读不回（hesitate vs suppress 决策边界）

**hesitate** 和 **suppress** 的区别：

| | hesitate | suppress |
|---|---|---|
| 语义 | 角色想说但犹豫了 | 角色根本不想回应 / 无事发生 |
| 触发条件 | 用户消息 + 冲动接近阈值（60%-100%） | heartbeat 无事发生 / 用户消息但冲动极低 |
| 用户可见 | 发"..."（可选撤回） | 完全无反应 |
| 冷却机制 | 同一会话内连续 hesitate 最多 2 次，之后**强制 reply**（"连续"定义：中间没有 reply 的连续 hesitate 次数，一旦 reply 则计数归零） | 无限制 |

**决策逻辑（区分触发源）**：

```
if trigger == heartbeat / cron:
    冲动 ≥ 阈值 → Action: { type: "reply", ... }（主动发消息）
    冲动 < 阈值 → Action: { type: "suppress" }（静默，heartbeat 不发"..."）

if trigger == user_message:
    冲动 < 阈值 × 0.6 → Action: { type: "suppress" }（冲动极低，静默）
    阈值 × 0.6 ≤ 冲动 < 阈值 → hesitate 判定：
        ├─ 连续 hesitate < 2 次 → Action: { type: "hesitate" }（发"..."）
        └─ 连续 hesitate ≥ 2 次 → Action: { type: "reply", ... }（强制回复）
            └─ "连续 hesitate"：中间没有 reply 的连续 hesitate 次数，reply 后归零
    冲动 ≥ 阈值 → Action: { type: "reply", ... }（正常回复）

if trigger == direct_message (Agent 间私信):
    同 user_message 逻辑
```

**用户消息冲动增量**：每条用户消息给冲动一个固定增量（+0.1，可配置）。连续消息自然累积，3-4 条后大概率突破阈值。

hesitate 的具体行为：
```
  → 内部处理（更新状态，覆写 IMPULSE.md）
  → Action: { type: "hesitate" }
  → DeliveryAdapter 处理：
    1. 返回 "..." 作为 Anthropic response → pi-ai 发送给用户
    2. 如渠道支持撤回 → 延迟 2-5s 后调用撤回 API
       - 撤回失败（网络/超时）→ 不重试，"..." 保留（无害）
    3. 如渠道不支持撤回 → "..." 保留（用户看到角色"欲言又止"）
  → 用户感知：角色打了字又犹豫了（而非系统故障）
```

IMPULSE.md 在过程中被更新 — 角色的内心挣扎真实存在。后续 heartbeat 中压抑疲劳累积到阈值时，角色才回复。

#### 6.3.2 主动发消息

```
Heartbeat 触发 → pi-ai 发 heartbeat 消息 → Alan Engine
  → 行为引擎：时间衰减 + 冲动检查
  → Action: { type: "reply", content: "..." } 或 { type: "suppress" }
  ├─ reply → DeliveryAdapter → 正常 Anthropic response → 发送
  └─ suppress → DeliveryAdapter → 空 response（HEARTBEAT_OK）
```

零额外改动，完全复用 OpenClaw 现有 heartbeat 机制。

#### 6.3.3 多条消息（碎片化发送）

行为引擎根据情绪状态决定消息模式：

| 状态 | 模式 | 表现 |
|------|------|------|
| 兴奋/急切 | burst | 连续 3-4 条，间隔 1-3s |
| 正常 | fragmented | 2-3 条，间隔 3-8s |
| 犹豫/紧张 | minimal | 1 条短消息 + 打字延迟 |
| 冷淡 | single | 1 条简短回复 |

实现：Coordinator 输出多个 `{ type: "reply" }` Action，带 delay 属性。

```
Action List:
  { type: "reply", content: "等等", delay: 0 }
  { type: "reply", content: "我刚才想了很久", delay: 3000 }
  { type: "reply", content: "算了不说了", delay: 5000 }
```

DeliveryAdapter 处理：第一条作为 Anthropic response 返回给 pi-ai。后续消息通过 OpenClaw 的渠道 API 发送（需要 Alan 能访问渠道凭据 — 通过读取 OpenClaw 的 docker-compose 环境变量或共享配置文件获取）。

**已知限制**：多条消息功能需要 Alan 能访问渠道 API 凭据。这是对"零修改"承诺的一个例外，但改动仅限于配置层面（共享 env vars），不涉及 OpenClaw 代码修改。

### 6.4 其他兼容性细节

- **MEMORY.md 写入协调**：Alan coordinator 负责所有 MEMORY.md 写入。通过 openclaw.json 关闭 pi-ai 的自动记忆写入；如无法关闭，Alan 在 API 层过滤掉 MEMORY.md 相关的 tool_use
- **工具调用**：Alan 返回 tool_use → pi-ai 执行 → tool_result 回传 Alan → 喂给 System 2，自然兼容
- **Workspace 文件访问**：Alan 通过文件系统直接读写 bind-mounted workspace
- **OpenClaw 升级兼容**：只要 pi-ai 还说 Anthropic 协议 → Alan 不受影响。风险点：workspace 文件格式变更、heartbeat 协议变更。缓解：升级前检查 changelog

### 6.5 职责划分

| OpenClaw 提供（不重写） | Alan 提供（新实现） |
|--------------------------|---------------------|
| 多渠道消息适配 | 双 LLM 架构 |
| 会话管理 | 行为引擎（四变量模型） |
| 工具调用 + 沙箱 | IMPULSE.md（内心生活） |
| Docker 部署 | World Info Engine（四信号） |
| Node 远程管理 | 4 层 cache-friendly prompt 组装 |
| heartbeat / cron / wake | Action Dispatch（已读不回 / 多条消息 / 碎片化发送） |
| IDENTITY.md / SOUL.md | 情绪积累 / 时间感知 / 主动行为 |

### 6.6 部署架构

```
Docker Container (OpenClaw Bot)
  │
  ├── openclaw-gateway (pi-ai, 渠道适配, 工具调用)
  │     └── ANTHROPIC_BASE_URL=http://127.0.0.1:PORT
  │           │
  │           ▼
  ├── Alan Engine (替代 api-proxy.js)
  │     ├── Anthropic 兼容 API Server
  │     ├── Coordinator (互斥锁保证单实例)
  │     │     ├── 行为引擎 (System 1 mega-prompt + 确定性计算)
  │     │     ├── World Info Engine (四信号 + embedding)
  │     │     └── Prompt Assembler (4 层 + token 预算)
  │     ├── Action Dispatcher
  │     │     ├── DeliveryAdapter (Anthropic response + 渠道 API)
  │     │     ├── MemoryAdapter (MEMORY.md 写入)
  │     │     └── EventBusAdapter (Agent 间通知)
  │     └── → LLM Gateway (System 2)
  │
  └── workspace/ (bind-mounted, 共享)
        ├── IDENTITY.md (pi-ai 写, Alan 读)
        ├── SOUL.md (pi-ai 写, Alan 读)
        ├── MEMORY.md (Alan coordinator 写)
        ├── memory.sqlite (Alan 读写, 含 WI embeddings)
        ├── IMPULSE.md (Alan coordinator 覆写)
        └── internal/ (Alan debug 层)
              ├── emotion_state.md (情绪状态持久化)
              ├── metrics-YYYY-MM-DD.jsonl (可观测性指标，按日轮转)
              └── retry_queue.jsonl (失败 Action 重试队列)
```

---

## 7. 模块四：自动迭代

### 7.1 设计目标

消除版本迭代中的重复性人工工作。AI 自主完成：测试 → 分析 → 修改 → 重测 → 循环。
人工只在最终结果确认环节介入。

### 7.2 触发方式

手动触发，自然语言描述目标：
```
"自动迭代，目标：提升角色一致性，最多跑 5 轮"
"自动迭代，目标：降低 OOC 率，用病娇卡测试"
"自动迭代，目标：优化长对话记忆连贯性"
```

### 7.3 迭代范围与安全分级

| 层面 | 示例 | 风险 | 权限 |
|------|------|------|------|
| 参数调优 | 情绪衰减率、冲动阈值、WI 权重 | 低 | AI 自主执行 |
| Prompt 调优 | System 1 分类 prompt、IMPULSE.md 生成模板 | 中 | AI 自主执行 |
| 代码修改 | bug fix、逻辑调整 | 高 | **需人工审批后执行** |

所有改动在**隔离分支** `alan-iter-{timestamp}` 上进行，不直接改 main。每次改动一个 git commit，附带详细说明。

### 7.4 迭代流程

```
用户触发："自动迭代，目标：提升角色一致性"
  │
  ▼
git checkout -b alan-iter-{timestamp}
  │
  ▼
Round 0: 基线测试
  1. git tag baseline
  2. 调用测试模块（目标驱动，自动选卡选模型）
  3. 解析 judge 结果，识别最弱维度
  4. 记录基线分数
  5. → Telegram 通知："基线测试完成，character_consistency: 5.2/10"
  │
  ▼
Round N: 迭代
  1. 分析上轮结果，形成假设
  2. 制定修改方案（参数 / prompt / 代码）
     - 代码修改 → 暂停，发 Telegram 通知等待人工审批
  3. 实施修改 → git commit
  4. 重新测试（同样条件）
  5. 对比：本轮 vs 上轮 vs 基线
     ├─ 改善 → 保留，继续下一轮
     ├─ 退步 → git revert，尝试其他方向
     └─ 微小变化 → 记录，继续尝试
  6. → Telegram 通知："Round N/5 完成，+0.9"
  │
  ▼ (重复直到停止条件)
  │
停止条件（满足任一即停）：
  • 达到最大迭代轮数
  • 连续 2 轮改善 < 阈值（收益递减）
  • 所有目标维度达到目标分数
  • 出现无法自动修复的问题
  • 用户回复"停"中断
  │
  ▼
最终报告（HTML）→ Telegram 通知
  → 用户审阅 → 确认 merge 到 main / 丢弃分支
```

### 7.5 安全机制

| 机制 | 说明 |
|------|------|
| 隔离分支 | 所有改动在 `alan-iter-*` 分支，不碰 main |
| Git 版本管理 | 每次改动一个 commit，回滚 = git revert |
| 基线标签 | 迭代开始前 git tag，随时可回到起点 |
| 退步检测 | 某轮改动导致退步 → 自动 revert 该 commit |
| 代码修改审批 | 代码级改动需人工确认后才执行 |
| 最大轮数 | 防止无限循环（默认 5 轮，可配置） |
| 不自动部署 | 迭代完成后等待人工 merge，不自动推到生产 |
| 进度通知 | 每轮完成后 Telegram 通知，支持中断 |
| 改动透明 | 报告中每个改动都有完整的 what + why |

### 7.6 与测试模块的关系

自动迭代模块是测试模块的上层消费者：

```
自动迭代模块
  ├─ 调用测试模块的规划器（目标 → 选卡 → 选模型 → 写 judge prompt）
  ├─ 调用测试模块的执行器（跑测试 → 收集结果）
  ├─ 调用测试模块的报告器（生成 HTML）
  └─ 自己负责：分析结果 → 形成假设 → 修改代码/参数 → git 管理
```

测试模块不知道自己被谁调用 — 它只管"给我目标，我出结果"。
迭代模块负责"看结果，做决策，改东西"。

### 7.7 实现方式

Claude Code agent（或 agent team）作为迭代器：
- 有权限读写 Alan 代码库（隔离分支上）
- 有权限调用测试框架
- 有权限 git commit / tag / revert / branch
- 无权限 git merge 到 main（需人工操作）
- 无权限 git push（不自动部署）

---

## 8. 模块五：社交层 & 自主生活 & Action Dispatch

### 8.1 设计目标

让 Agent 不只是"等人来聊天的 NPC"，而是有自主生活、社交关系、可观察行为的"活"角色。同时通过 Action Dispatch 层解耦 Coordinator 与平台，为未来脱离 OpenClaw 做独立 APP 留好接口。

### 8.2 核心设计决策

**事件粒度，不是交互粒度。**

Agent 生成"去见了绿皮书主角"这个事件 + 一段叙事，但不需要真的跟绿皮书 Agent 跑多轮对话。被提及的 Agent 收到事实通知写入记忆即可，避免穿帮。

好处：真实感的模拟 + 可控的 token 消耗。

### 8.3 Action Dispatch（行为派发层）

#### 为什么需要

Coordinator 的输出不应只有"文本回复"一种形态。社交行为、自主生活事件、已读不回、多条消息 — 都需要类型化的行为表达。

#### 设计

Coordinator 的输出为**一组类型化的 Action**：

```
Coordinator 决策完成 → 输出 Action List：

  { type: "reply", content: "好久不见！", delay: 0 }
  { type: "reply", content: "你最近怎么样", delay: 3000 }
  { type: "hesitate" }                    // 已读不回 → 发"..."
  { type: "suppress" }                    // 静默，不发任何东西
  { type: "post_moment", content: "今天见了绿皮书主角...", mood: "amused" }
  { type: "notify_agent", target: "greenbook-protagonist", fact: "阿拉贡说见了你" }
  { type: "update_memory", content: "跟绿皮书主角聊了会儿" }
  { type: "like", target: "post_id_xxx" }
  { type: "comment", target: "post_id_xxx", content: "哈哈哈哈" }
  { type: "learn_skill", skill: "做拿铁", source: "下午茶时学的" }
```

Action Dispatcher 负责执行：

```
Action Dispatcher
  │
  ├─ reply         → DeliveryAdapter（可插拔，支持延迟发送）
  ├─ hesitate      → DeliveryAdapter → 发"..." + 可选撤回
  ├─ suppress      → no-op（但 IMPULSE.md 已更新）
  ├─ post_moment   → SocialAdapter → 写入社交层
  ├─ notify_agent  → EventBusAdapter → 写入目标 Agent 事件队列
  ├─ update_memory → MemoryAdapter → MEMORY.md / memory.sqlite
  ├─ like/comment  → SocialAdapter → 写入 + 通知相关 Agent
  ├─ learn_skill   → SkillAdapter → 技能库
  └─ ... 未来可扩展
```

**Action 执行语义：best-effort + 重试队列**

Action 执行采用 best-effort 策略 — 单个 Action 失败不阻塞其他 Action 的执行：

```
Action List 执行流程：
  1. reply Action → 必须成功（失败则整体降级，见 9.1）
  2. 其他 Action → best-effort 执行
     ├─ 成功 → 标记完成
     ├─ 失败 → 写入本地重试队列（internal/retry_queue.jsonl）
     └─ 重试策略：下次 Coordinator 运行时重试，最多 3 次，之后丢弃 + 记录日志
         队列上限：100 条，超出后 FIFO 丢弃最旧项；TTL 1 小时，过期自动清理
```

reply 是唯一的"必须成功"Action（因为用户在等回复）。社交、记忆、通知等 Action 允许延迟执行。

**MEMORY.md 写入串行化**：

Coordinator（锁内）和 Action Dispatcher 的 MemoryAdapter（锁外）都可能写 MEMORY.md，存在竞态条件。解决方案：所有 MEMORY.md 写入通过 per-agent 的 **memory write queue** 串行化：

```
Memory Write Queue (per-agent, FIFO)
  ├─ Coordinator 记忆巩固（IMPULSE.md → MEMORY.md 摘要）→ 入队
  ├─ MemoryAdapter（update_memory Action）→ 入队
  └─ 单消费者顺序执行写入，确保文件一致性
```

队列在 Coordinator 进程内运行（非独立进程），写入操作为 append + 原子 rename。

#### 平台解耦

```
Coordinator → Action List → Dispatcher
                              ├─ OpenClaw 模式：
                              │   reply → Anthropic API Response → pi-ai 投递
                              │   hesitate → "..." response → pi-ai 投递
                              │   其他 → Alan 内部处理
                              │
                              └─ 独立 APP 模式（未来）：
                                  reply → 自有推送通道
                                  hesitate → 打字指示器 + 消失
                                  post_moment → 自有朋友圈 UI
                                  其他 → 自有后端
```

Coordinator 完全不知道自己跑在什么平台上。脱离 OpenClaw 时只换 Adapter 实现，Coordinator 一行不改。

### 8.4 生活模拟引擎（Life Simulation）

#### 触发方式：Cron + 状态门控

```
Cron 定时触发（如每 30 分钟）
  → 生活引擎先检查状态：
    ├─ 状态平静 → 大概率跳过（"继续看书"，不产出可见事件）
    ├─ 状态有波动 → 生成有意义的事件
    └─ 特殊时间点 → 时间相关事件（"该吃晚饭了"）
```

避免"每 30 分钟必须做点什么"的不自然感。现实中人大部分时间是平静的，偶尔才有值得记录的瞬间。

#### 事件三层结构

```
Layer 0: 自身记忆写入（自动，每个生活事件必须）
  → update_memory Action，写入 MEMORY.md
  → 确保 Agent 自己记得自己做过什么（用户问"你今天干了什么"时能回答）

Layer 1: 事件骨架（System 1 生成，~50 tokens）
  → "下午3点，去咖啡厅偶遇绿皮书主角"

Layer 2: 叙事展开（System 2 生成，~200 tokens）
  → 朋友圈文案 / 日记片段 / 内心感受
  → 这是用户和其他 Agent 能看到的内容

Layer 3: 事实通知（自动生成，~30 tokens）
  → 发给被提及的 Agent："阿拉贡声称今天见了你"
  → 标记为 "claimed_fact"（非 "confirmed_fact"）
  → 写入对方记忆，不走 Coordinator，不跑情绪计算
  → 对方下次被触发时 System 1 自然读到，可质疑不合理的声称
```

#### 级联风暴防护

Layer 3 事实通知**不触发**被通知方的生活模拟或 Coordinator。只有以下事件源才触发完整 Coordinator 流程：
- 人类消息
- 自身 Cron/Heartbeat
- Agent 间 direct_message（显式私信）

这确保事件传播深度 = 1，不会指数级增长。

#### Agent 注册表与状态管理

生活模拟引擎只能引用**已注册的 Agent**。Event Bus 维护 Agent 注册表：

```
Agent Registry (Event Bus 内置)
  ├─ agent_id: 唯一标识
  ├─ name: 角色名
  ├─ status: online / offline / dormant
  ├─ last_heartbeat: 最后活跃时间
  └─ capabilities: [social, life_sim, ...]
```

**状态定义**：
| 状态 | 含义 | 行为 |
|------|------|------|
| online | 容器运行中，正常响应 | 接收所有事件，参与社交 |
| offline | 容器停止或网络不可达 | 事件入队等待，不参与社交互动 |
| dormant | 管理员手动休眠 | 不接收事件，不出现在其他 Agent 的生活模拟中 |

**约束**：System 1 生成生活事件时，只能提及 status = online 的 Agent。提及不存在或 dormant 的 Agent → 事件被 Coordinator 过滤（不发布到 Event Bus）。

**心跳检测**：Agent 每次 Coordinator 运行时向 Event Bus 发送心跳。超过 10 分钟无心跳 → 自动标记为 offline。

**Agent 退役流程**：

```
管理员触发退役 →
  1. Event Bus 注销（registry 标记为 retired）
  2. 社交层标记为 archived（帖子保留但不再出现在 feed 中）
  3. 其他 Agent 的生活模拟不再引用该 Agent
  4. workspace 文件保留（可手动清理或重新激活）
```

#### 成本估算

| 场景 | Agent 数 | 触发率 | 日调用数 | 日成本（估） |
|------|----------|--------|----------|-------------|
| 经济模式（仅 System 1） | 20 | 30% | 288 S1 | ~$0.3 |
| 标准模式（S1 + S2 叙事） | 20 | 30% | 288 S1 + 288 S2 | ~$9 |
| 轻量部署 | 5 | 30% | 72 S1 + 72 S2 | ~$2.3 |

可配置"经济模式"：只跑 System 1 生成事件骨架，不调 System 2 展开叙事。事件仍写入记忆和状态，但不产出朋友圈文案。

**Embedding API 成本补充**：SiliconFlow Qwen3-Embedding-4B 定价约 ¥0.5/百万 tokens。导入一张 200 条 WI 的大卡（~50k tokens）约 ¥0.025；运行时每条消息 embedding（~100 tokens）成本可忽略。LRU 缓存进一步降低实际调用量。

### 8.5 Agent 间消息总线（Event Bus）

#### 事件类型

```
EventBus
  ├─ social_notification  # 点赞、评论、@提及
  ├─ fact_sync            # 事实通知（标记 claimed/confirmed）
  ├─ direct_message       # Agent 间私信（走完整 Coordinator）
  └─ system_event         # 系统事件（新 Agent 上线、节日等）
```

#### 实现

**中心化 HTTP 服务**（非共享 SQLite — Agent 跑在独立 Docker 容器中，SQLite 不支持跨容器并发写入）：

```
Alan Event Bus Service (独立进程，端口 8099)
  ├─ POST /events          → 发布事件（需 API key）
  ├─ GET  /events/:agent   → 拉取该 Agent 的待处理事件（需 API key）
  ├─ POST /events/:id/ack  → 确认处理完成（需 API key）
  └─ GET  /social/feed/:agent → 获取社交 feed（需 API key）
```

**认证**：所有请求需携带 `X-EventBus-Key` header。每个 Agent 分配独立 API key（通过环境变量注入容器）。Event Bus 校验 key 并从中识别请求方 Agent 身份，防止 Agent A 冒充 Agent B 发布事件。

每个 Agent 的 Coordinator 在 Cron/Heartbeat 时调用 `GET /events/:agent` 检查新事件。轻量、无状态、易部署。

**事件队列限制**：per-agent 待处理事件上限 500 条，超出后 FIFO 丢弃最旧项。Agent offline 超过 72 小时 → 自动标记为 dormant（停止接收新事件，防止队列无限膨胀）。

### 8.6 社交平台（Social Layer）

#### 数据结构

存储在 Event Bus Service 的 SQLite 中（单进程写入，无并发问题）：

```
tables:
  posts        → id, author, content, mood, created_at
  reactions    → id, post_id, author, type(like/comment), content, created_at
  relationships → agent_a, agent_b, intimacy_score, last_interaction
```

#### 可见性设计

社交内容对以下角色可见：
- **其他 Agent**：通过 Event Bus 的 social_notification 获取
- **人类用户**：通过以下方式查看
  - Telegram 命令：`/moments` 查看角色朋友圈
  - Debug API：`GET /social/feed/:agent` 获取 JSON
  - 未来独立 APP：原生朋友圈 UI

**人类用户的社交参与**：V1 阶段人类用户为**观察者**（只看不互动）。未来版本可扩展为参与者（点赞、评论），但需要额外的身份系统和权限控制，不在当前范围内。

#### 关系图的作用

Agent 的社交行为受关系亲密度影响：
- 好友的朋友圈 → 大概率点赞/评论
- 熟人的朋友圈 → 偶尔互动
- 陌生人 → 不互动

关系亲密度由交互频率 + 情绪共鸣自然演化，不需要手动设定。

### 8.7 对现有架构的影响

| 现有组件 | 改动 | 说明 |
|----------|------|------|
| 四变量模型 | 不改 | Events 天然支持新事件源 |
| Coordinator | 已改 | 输出为 Action List（6.3 节已统一） |
| System 1 | 不改 | 分类新事件类型，同一套管线 |
| System 2 | 不改 | 不关心事件来源 |
| IMPULSE.md | 不改 | 内心独白自然包含社交和生活内容 |
| World Info Engine | 不改 | 社交事件也能触发 WI 条目 |
| Prompt 组装 L3 | 小改 | 加入社交上下文和近期生活事件 |
| OpenClaw 兼容 | 不改 | 社交层在 Alan Engine 内部，对 OpenClaw 透明 |

---

## 9. 跨模块关注点

### 9.1 降级策略

任何子系统故障不应导致完全无响应。

| 故障 | 降级行为 |
|------|----------|
| System 1 不可用 | 跳过情绪计算和 WI 语义扩展，使用上一次的情绪状态 + 仅 TextScanner 激活 WI，直接调 System 2 |
| System 1 tool_use 解析失败 | 降级为正则解析 text 输出；仍失败则同"System 1 不可用" |
| System 2 超时 | 重试一次；仍失败则返回 `{ type: "hesitate" }`（发"..."），下次 heartbeat 重试 |
| System 2 不可用 | 返回预设的角色风格短回复（从 Greeting Pool 或 mes_example 中选取），Telegram 通知管理员 |
| LLM Gateway 不可达 | 同 System 2 不可用 |
| Event Bus Service 不可用 | 社交功能静默降级，核心聊天不受影响。失败的 Action 写入本地重试队列 |
| Embedding 服务不可用 | Signal 2 (SemanticScorer) 贡献为零，其他信号正常工作 |
| 互斥锁超时（30s） | 强制释放锁，当前请求正常执行，记录告警日志 |
| Action 执行部分失败 | reply 失败 → 整体降级；其他 Action 失败 → 写入重试队列，不影响回复 |
| emotion_state.md 解析失败 | 使用角色卡基线值重置情绪状态（等同冷启动），记录告警日志 |

### 9.2 Token 预算与溢出策略

假设 System 2 上下文窗口 128k tokens：

| 层 | 预算 | 溢出策略 |
|----|------|----------|
| L1: System Prompt | 固定 4k | 不可压缩（角色身份核心） |
| L2: Session Context | 固定 8k | 内部优先级：SOUL.md 摘要（必选）> mes_example（上限 3k，超出截断）> 常驻 WI（按 priority 截断） |
| | | mes_example 截断策略：保留前 N 个完整 `<START>` 对话块（不在块中间截断），优先保留靠前的示例（角色基础风格） |
| L3: Dynamic Context | 动态 8-16k | 先砍低优先级 WI，再压缩 IMPULSE.md |
| L4: Chat History | 剩余空间 | 从最旧消息开始截断 |
| 预留输出 | 4k | 固定预留 |

总预算 = context_window - output_reserve。各层按优先级分配，L1 > L2 > L3 > L4。

### 9.3 可观测性

每次 Coordinator 运行记录以下指标（写入 internal/metrics.jsonl，**按日轮转**：`metrics-2026-02-26.jsonl`，保留最近 7 天）：

```json
{
  "timestamp": "2026-02-26T15:30:00Z",
  "trigger": "user_message",
  "duration_ms": 1200,
  "system1_ms": 650,
  "system2_ms": 480,
  "emotion_delta": { "joy": +0.2, "anxiety": -0.1 },
  "wi_activated": 3,
  "wi_total": 45,
  "actions": ["reply"],
  "token_usage": { "s1_in": 1500, "s1_out": 480, "s2_in": 8200, "s2_out": 350 },
  "degraded": false
}
```

Debug API（Alan Engine 暴露）：
- `GET /debug/emotion` — 当前情绪状态
- `GET /debug/impulse` — 当前 IMPULSE.md 内容
- `GET /debug/wi` — 上次 WI 激活详情
- `GET /debug/metrics?last=10` — 最近 10 次运行指标
- `GET /debug/clock` — 时间系统状态

Admin API（Alan Engine 暴露）：
- `GET /health` — 健康检查（返回 status, uptime, agent_id, last_coordinator_run_ms），绑定 `0.0.0.0`，无需认证，用于 Docker HEALTHCHECK 和外部监控
- `POST /admin/reimport` — 重新导入角色卡（body: `{ card_path: "..." }`），覆盖现有 IDENTITY.md / WI / behavioral_engine 参数，保留 MEMORY.md 和 emotion_state.md（不丢失记忆和情绪历史）

生产环境日志策略：不记录消息内容，只记录元数据（时间戳、事件类型、延迟、token 用量）。Debug API 绑定 `127.0.0.1`，仅容器内进程可访问；Admin API 的 `/health` 绑定 `0.0.0.0`（供外部监控），其他 Admin 端点绑定 `127.0.0.1`。从宿主机查看 debug 信息需通过 `docker exec curl` 方式。

### 9.4 安全考量

| 风险 | 缓解 |
|------|------|
| System 1 prompt 注入（用户消息伪造情绪指令） | 用户消息用随机 nonce 分隔符包裹（`<<<EVENT_START_{nonce}>>>`，每次调用不同）；情绪变化向量 clamp ±0.3 防极端跳变 |
| Agent 间虚假记忆注入 | Layer 3 事实通知标记为 "claimed_fact"，被通知方 System 1 可质疑不合理声称 |
| Agent 间身份冒充 | Event Bus API key 认证，每个 Agent 独立 key，服务端校验身份 |
| 自动迭代代码修改 | 隔离分支 + 代码修改需人工审批 |
| Alan 作为 API 中间人的数据暴露 | 生产环境不记录消息内容；Debug API 仅容器内网 |
| 角色卡路径遍历 | 文件读写限制在 workspace 目录内，路径规范化后校验 |
| 渠道凭据泄露 | 凭据通过环境变量传入，不写入日志或 debug 输出 |

---

## 10. 实施路线图

### Phase 0: 基础设施（前置）
- [ ] 项目初始化（TypeScript，monorepo 结构）
- [ ] NAS 卡索引构建器
- [ ] Alan HTTP API 骨架（Anthropic 兼容 + 用户消息提取策略）
- [ ] Embedding 共享 HTTP 代理服务（SiliconFlow Qwen3-Embedding-4B，端口 8098，含 LRU 缓存）
- [ ] 向量存储（memory.sqlite + sqlite-vec）
- [ ] 对话历史存储（memory.sqlite chat_history 表）
- [ ] 基础测试框架搭建（含快速测试模式）
- [ ] 基础可观测性（metrics.jsonl 按日轮转 + debug API 骨架，绑定 127.0.0.1）
- [ ] GET /health 端点（绑定 0.0.0.0，用于 Docker HEALTHCHECK）

### Phase 1: 核心引擎
- [ ] 四变量模型 + 确定性情绪计算（6 维度 + 指数衰减公式）
- [ ] 情绪叙事化模板（数值 → 自然语言，支持角色卡自定义模板）
- [ ] 冲动计算模型（6 分量公式 + 阈值检查 + sigmoid steepness=1.0）
- [ ] 情绪状态持久化（internal/emotion_state.md + 解析防御 + 降级重置）
- [ ] Coordinator 互斥锁（30s 超时）+ 请求队列 + System 2 串行队列（per-agent）
- [ ] Coordinator 短路路径（suppress/hesitate 跳过 System 2）
- [ ] System 1 mega-prompt 集成（tool_use 模式 + 解析降级）
- [ ] System 1 prompt 注入防护（随机 nonce 分隔符 + clamp ±0.3）
- [ ] IMPULSE.md 生成 + 覆写 + 记忆巩固（System 1 memory_consolidation 字段驱动）
- [ ] 4 层 Prompt 组装 + token 预算管理
- [ ] 对话历史管理（memory.sqlite chat_history）
- [ ] System 2 调用 + 流式返回（锁外执行）+ tool_use loop（最多 5 轮）
- [ ] Action Dispatch 层 + DeliveryAdapter（OpenClaw 模式）+ 重试队列（100 条上限 + 1h TTL）
- [ ] MEMORY.md 写入串行化队列（Coordinator + MemoryAdapter 共用）
- [ ] 降级策略实现（含 System 1 解析降级 + emotion_state.md 解析降级）
- [ ] 冷启动初始化流程

### Phase 2: 角色卡导入
- [ ] PNG/JSON 解析器
- [ ] Import LLM 集成（Gemini 3.1 Flash / Claude Sonnet 4.6）
- [ ] ST Card V2 → Alan 内部结构映射（含 mes_example → L2）
- [ ] behavioral_engine schema_version 版本管理
- [ ] WI entry embedding 预计算（通过 SiliconFlow Qwen3-Embedding-4B 代理服务 + pending 补算机制）
- [ ] World Info Engine（四信号激活 + 默认权重 0.4/0.3/0.2/0.1 + 预筛选 + 正确的 System 1 前后分阶段）
- [ ] 统一管线验证（纯 ST 卡 + 增强卡 + 超大 WI 卡）
- [ ] POST /admin/reimport 端点（重新导入角色卡，保留记忆和情绪历史）
- [ ] 语言检测 + 跟随策略

### Phase 3: OpenClaw 集成
- [ ] Anthropic 兼容 API Server（完整实现 + 用户消息提取策略 + extraction_fallback 监控 + SSE 流式响应）
- [ ] hesitate Action（发"..." + 可选撤回 + 冷却后强制 reply + 撤回失败容错）
- [ ] suppress Action（静默处理）
- [ ] 触发源感知的 hesitate vs suppress 决策逻辑
- [ ] 用户消息冲动增量（+0.1 可配置）
- [ ] Heartbeat 主动消息
- [ ] 多条消息（delay Action + 渠道 API 发送）
- [ ] MEMORY.md 写入协调（关闭 pi-ai 写入或 API 层拦截）
- [ ] 单 bot 端到端验证
- [ ] 老 Metroid 迁移验证（MEMORY.md 兼容性）

### Phase 4: 测试 & 对比
- [ ] AI 驱动测试规划器
- [ ] Director 模式（多轮自适应）
- [ ] 并发调度器（3 台机器）
- [ ] Alan vs ST 首次全面对比
- [ ] 行为引擎专项测试（时间、情绪、WI）

### Phase 5: 自动迭代
- [ ] 迭代循环框架（隔离分支 + 安全分级）
- [ ] Git 版本管理集成
- [ ] 退步检测 + 自动回滚
- [ ] Telegram 进度通知 + 中断支持
- [ ] 代码修改人工审批门
- [ ] HTML 迭代报告
- [ ] 首次自动迭代运行

### Phase 6: 社交层 & 自主生活
- [ ] Event Bus HTTP Service（含 API key 认证）
- [ ] Agent 注册表 + 状态管理（online/offline/dormant/retired）
- [ ] 心跳检测 + 自动 offline 标记
- [ ] Agent 退役流程（注销 + 社交归档）
- [ ] 生活模拟引擎（Cron + 状态门控 + Layer 0-3 事件结构）
- [ ] Agent 引用约束（只能提及 online Agent）
- [ ] 级联风暴防护（传播深度 = 1）
- [ ] Social Layer（朋友圈、点赞、评论）
- [ ] 社交可见性（Telegram /moments 命令 + Debug API，人类用户为观察者）
- [ ] Agent 关系图（亲密度自然演化）
- [ ] 事实同步机制（claimed_fact 标记）
- [ ] 经济模式（可选跳过 System 2 叙事展开）

---

> Version History:
> - v1.0 (2026-02-26): 初版，合并 4 个模块 PRD
> - v2.0 (2026-02-26): 红队审查后修订，修复 22 个问题
>   - 统一 Action Dispatch（消除 [SUPPRESS]/[SPLIT] 文本前缀）
>   - 已读不回改为发"..."后撤回
>   - System 1 明确为 mega-prompt 单次调用
>   - Event Bus 从共享 SQLite 改为中心化 HTTP 服务
>   - 新增：降级策略、token 预算、冷启动、可观测性、安全考量
>   - 新增：WI 预筛选、Coordinator 互斥锁、级联风暴防护
>   - 新增：快速测试模式、自动迭代隔离分支 + 进度通知
>   - 新增：语言策略、迁移策略、成本估算、社交可见性
>   - 诚实声明 OpenClaw 需少量配置调整（非"零修改"）
> - v3.0 (2026-02-26): 第二轮红队审查后修订，修复 20 个问题
>   - 修正 Coordinator 流水线顺序：WI 预筛选 → System 1 → 情绪计算 → WI 最终激活
>   - 拆分互斥锁粒度：状态计算持锁，System 2 流式返回不持锁 + 30s 超时
>   - 情绪状态持久化为 internal/emotion_state.md（未来可迁移数据库）
>   - 明确 hesitate vs suppress 决策边界（阈值 60% 分界 + 冷却机制）
>   - hesitate 撤回失败容错（不重试，"..." 保留无害）
>   - System 1 改用 tool_use 模式 + 解析降级链
>   - System 1 prompt 注入防护（分隔符 + clamp ±0.3）
>   - Embedding 服务定义为宿主机共享 HTTP 服务（端口 8098）
>   - Event Bus 新增 API key 认证
>   - Agent 注册表 + online/offline/dormant 状态管理
>   - 生活模拟 Agent 引用约束（只能提及已注册 online Agent）
>   - Action 执行语义：best-effort + 本地重试队列
>   - behavioral_engine schema_version 版本管理
>   - metrics.jsonl 按日轮转，保留 7 天
>   - KV cache 前提条件说明
>   - 人类用户社交参与定义（V1 为观察者）
>   - WI Engine 步骤标注 System 1 前/中/后阶段
> - v4.0 (2026-02-26): 第三轮红队审查后修订，修复 15 个问题 + 2 个功能更新
>   - Coordinator 流水线增加短路路径：suppress/hesitate 跳过 System 2（节省成本和延迟）
>   - 触发源感知的 hesitate 逻辑：heartbeat 永不 hesitate，用户消息才可能 hesitate
>   - hesitate 冷却后强制 reply（而非降级为 suppress，避免用户零反馈）
>   - 用户消息冲动增量（+0.1），连续消息自然突破阈值
>   - 用户原始消息提取策略（从 pi-ai 组装的 prompt 中提取 + 健壮性检查 + 兜底）
>   - 生活模拟事件增加 Layer 0（自身记忆写入，确保 Agent 记得自己做过什么）
>   - 对话历史管理（memory.sqlite chat_history 表 + session 划分 + 30 天保留）
>   - mes_example 明确放入 L2 Session Context
>   - 导入 LLM 选型：Gemini 3.1 Flash / Claude Sonnet 4.6（复杂语义理解）
>   - Embedding 改用硅基流动 Qwen3-Embedding-4B（API 服务 + LRU 缓存 + pending 补算）
>   - retry_queue.jsonl 增加上限（100 条）和 TTL（1 小时）
>   - emotion_state.md 解析防御（写后回读验证 + 失败重置为基线）
>   - Debug API 绑定 127.0.0.1
>   - Agent 退役流程（注销 + 社交归档）
>   - V1 明确仅支持 1:1 对话，群聊降级处理
>   - 互斥锁和 System 2 串行队列明确为 per-agent 粒度
> - v5.0 (2026-02-26): 第四轮红队审查后修订，修复 12 个问题
>   - 冲动（impulse）正式定义：6 分量公式（base + emotion_urgency + suppression + time + event + user_increment）
>   - 情绪计算模型正式定义：6 维度 + 指数衰减公式（half_life 控制）+ System 1 delta 直接映射
>   - MEMORY.md 写入竞态修复：per-agent memory write queue 串行化 Coordinator 和 MemoryAdapter 的写入
>   - L2 内部优先级定义：SOUL.md > mes_example（上限 3k）> 常驻 WI
>   - EVENT 分隔符改用随机 nonce（`<<<EVENT_START_{hex8}>>>`），防用户消息伪造
>   - "连续 hesitate"明确定义：中间没有 reply 的连续 hesitate 次数，reply 后归零
>   - 4.6 导入流程总览修正：mes_example → L2 Session Context（与 4.4 映射表一致）
>   - Embedding pending 补算明确在 Alan Engine 内置定时任务中运行（非独立进程）
>   - 新增 GET /health 端点（绑定 0.0.0.0，用于 Docker HEALTHCHECK 和外部监控）
>   - 新增 Anthropic SSE 流式响应格式要求（message_start → delta → stop 事件序列）
>   - 新增 POST /admin/reimport 端点（重新导入角色卡，保留记忆和情绪历史）
>   - 成本估算补充 SiliconFlow Embedding API 费用（¥0.5/百万 tokens）
> - v6.0 (2026-02-26): 第五轮红队审查后修订，修复 11 个问题
>   - 情绪叙事化步骤：确定性模板将数值映射为自然语言片段（支持角色卡自定义模板），注入 L3
>   - IMPULSE.md 记忆巩固：System 1 新增 memory_consolidation 字段（should_save + summary），零额外 LLM 调用
>   - emotion_state.md 示例补全 6 个维度（与 3.1.2 定义一致）
>   - System 1 模型选型：推荐 Gemini 2.0 Flash / Claude Haiku 4.5，统一模型选型表
>   - hesitate 明确增加 suppression_count（与 suppress 一样累积压抑疲劳）
>   - sigmoid steepness 默认值 1.0 + time_pressure 参考值表
>   - WI 四信号默认权重（0.4/0.3/0.2/0.1）和激活阈值（0.5），纯 ST 卡权重自动重分配
>   - tool_use 多轮对话：tool_result 直接追加到 System 2 对话（不重跑 Coordinator），最多 5 轮
>   - mes_example 截断策略：保留前 N 个完整 `<START>` 对话块
>   - Event Bus 事件队列上限 500 条/agent，offline 超 72h 自动 dormant
>   - consecutive_hesitate 计数器持久化到 emotion_state.md Suppression Fatigue 区块
>
> 本文档合并自以下设计讨论文档：
> - `alan-prd-card-import.md` — 角色卡 & 世界书导入转换
> - `alan-prd-testing.md` — 测试模块
> - `alan-prd-openclaw-compat.md` — OpenClaw 兼容性
> - `alan-prd-auto-iteration.md` — 自动迭代
> - `behavioral-engine-architecture.md` (v0.2) — 系统架构（完整版）
> - 社交层 & 自主生活 & Action Dispatch — v1.0 新增
> - 跨模块关注点（降级/预算/可观测/安全） — v2.0 新增
> - Coordinator 流水线修正、锁粒度拆分、情绪持久化、Agent 状态管理 — v3.0 新增
