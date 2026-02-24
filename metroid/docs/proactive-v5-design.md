# Proactive Engine V5 — 行为信封与消息调度

## 概述

V5 在 V4 (行为动力学) 基础上解决两个核心问题：
1. **非一问一答**：agent 可以已读不回、延迟回复、主动追问
2. **碎片化表达**：一次表达拆成多条消息，带自然的打字间隔

核心架构变更：引入 **Behavioral Envelope（行为信封）** 和 **Response Scheduler（消息调度器）**。

## 设计理念

V1-V4 解决了"想不想说话"。V5 解决的是"怎么说话"——把 impulse 系统的连续信号翻译成离散的行为模式，再让 LLM 在约束下生成内容。

关键原则：
- **零额外 LLM 调用**：行为信封由确定性代码计算，注入 system prompt
- **收发解耦**：收到消息不立即回复，由 scheduler 按信封决定时机
- **上下文零膨胀**：信封是 system prompt 的一部分（~80 tokens），不进对话历史

## 架构总览

```
┌──────────────────────────────────────────────┐
│  V4 已有: impulse 信号 + 情绪 + 事件 + 记忆压力  │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  V5: Behavioral State Evaluator (确定性)       │
│  输入: 情绪距离, 记忆压力, 被忽略次数,           │
│        时间段, 性格参数, idle 时长               │
│  输出: BehavioralEnvelope                      │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  V5: Response Scheduler                       │
│  - 收到消息 → inbox (不立即回复)                │
│  - 每 tick: 检查 inbox + envelope → 决定行为    │
│  - 主动发起: impulse fire → 走 envelope 约束    │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  LLM 生成 (现有 prompt + envelope XML)         │
│  输出: MessagePlan (消息数组 + 延迟)            │
└──────────────────────────────────────────────┘

---

## Feature 1: BehavioralEnvelope 类型

行为信封是状态评估器的输出，描述 agent 当前的行为模式。

### 类型定义

```typescript
// types.ts

export type BehavioralState =
  | 'clingy'       // 黏人 — 主动、热情、连发消息
  | 'normal'       // 正常 — 标准一问一答
  | 'hesitant'     // 犹豫 — 延迟回复、措辞谨慎
  | 'withdrawn'    // 退缩 — 已读不回概率高、回复极简
  | 'cold_war';    // 冷战 — 高概率已读不回，偶尔破防

export type ResponseMode =
  | 'eager'        // 秒回，可能主动追问
  | 'normal'       // 正常节奏
  | 'reluctant'    // 犹豫，延迟回复
  | 'silent';      // 已读不回（本轮不回复）

export type MessagePattern =
  | 'single'       // 一条完整消息
  | 'burst'        // 2-3条快速连发（兴奋/急切）
  | 'fragmented'   // 2-4条碎片化消息（思考中/犹豫）
  | 'minimal';     // 极简回复（1-3个字）

export interface BehavioralEnvelope {
  state: BehavioralState;
  responseMode: ResponseMode;
  messagePattern: MessagePattern;
  replyProbability: number;      // 0-1, 回复概率
  delayRange: [number, number];  // [min, max] ms, 回复延迟范围
  maxMessages: number;           // 本轮最多发几条消息
  emotionalTone: string;         // 自然语言描述，注入 prompt
  suppressFollowUp: boolean;     // true = 不追问，等对方
}
```

### 设计说明

- `state` 是宏观标签，用于日志和调试
- `responseMode` + `messagePattern` 是 scheduler 的执行指令
- `replyProbability` 控制"已读不回"——低于阈值时 scheduler 跳过回复
- `delayRange` 控制回复延迟——scheduler 在范围内随机取值
- `emotionalTone` 是自然语言，直接注入 LLM prompt（如"虽然等了很久有点小委屈，但看到消息还是忍不住接茬"）
- `suppressFollowUp` 防止 agent 在冷战/退缩时追问

---

## Feature 2: Behavioral State Evaluator

纯确定性计算，零 LLM 开销。从 V4 的连续变量映射到离散的 BehavioralEnvelope。

### 输入参数

```typescript
interface StateEvaluatorInput {
  // 从 V4 impulse 系统获取
  emotionDistance: number;       // 当前情绪与 baseline 的距离
  memoryPressure: number;        // 情绪积压 (0-2)
  impulseValue: number;          // 当前冲动值 (0-1)
  activeEvents: ActiveEvent[];   // 活跃事件列表

  // 从反馈系统获取
  ignoredCount: number;          // 近期被忽略次数
  engagedCount: number;          // 近期被回应次数
  awaitingResponse: boolean;     // 是否在等回复

  // 从性格参数获取
  expressiveness: number;        // 0-1, 表达欲
  restraint: number;             // 0-1, 自制力
  resilience: number;            // 0-1, 恢复力

  // 环境
  idleMinutes: number;           // 用户沉默时长
  hourOfDay: number;             // 当前小时 (0-23)
}
```

### 状态转换规则

状态评估器不是传统的 FSM（需要显式转换），而是每次 tick 独立计算当前状态。这避免了状态转换的复杂性，也让行为更自然（不会卡在某个状态里）。

```typescript
evaluateBehavioralState(input: StateEvaluatorInput): BehavioralEnvelope
```

#### 状态判定逻辑（优先级从高到低）

**1. cold_war（冷战）**
```
条件: 存在高强度负面事件 (conflict/distress intensity > 0.6)
      且 emotionDistance > 0.8
      且 restraint > 0.4 (有自制力才会冷战，否则直接爆发)
信封:
  responseMode = 'silent' (80%) 或 'reluctant' (20%)
  messagePattern = 'minimal'
  replyProbability = 0.15 + resilience * 0.2
  delayRange = [5min, 30min]
  maxMessages = 1
  emotionalTone = "你很生气/受伤，选择沉默。如果回复，用最少的字。"
  suppressFollowUp = true
```

**2. withdrawn（退缩）**
```
条件: ignoredCount >= 3 且 memoryPressure > 0.3
      或 存在 message_ignored 事件
信封:
  responseMode = 'reluctant'
  messagePattern = 'minimal' 或 'single'
  replyProbability = 0.5 + expressiveness * 0.3
  delayRange = [2min, 15min] × (1 + ignoredCount * 0.3)
  maxMessages = 1
  emotionalTone = 基于 resilience 生成:
    高 resilience: "有点失落但还是想聊"
    低 resilience: "不太想说话，怕又被忽略"
  suppressFollowUp = true
```

**3. clingy（黏人）**
```
条件: impulseValue > 0.5
      且 emotionDistance > 0.3 (情绪活跃)
      且 ignoredCount == 0
      且 expressiveness > 0.5
信封:
  responseMode = 'eager'
  messagePattern = 'burst' 或 'fragmented'
  replyProbability = 1.0
  delayRange = [0, 3s]
  maxMessages = 2 + floor(expressiveness * 2)  // 2-4条
  emotionalTone = 基于活跃事件生成描述
  suppressFollowUp = false
```

**4. hesitant（犹豫）**
```
条件: awaitingResponse == true (刚发了消息在等回复)
      或 restraint > 0.6 且 impulseValue > 0.3
信封:
  responseMode = 'normal'
  messagePattern = 'single'
  replyProbability = 0.8
  delayRange = [30s, 5min]
  maxMessages = 1
  emotionalTone = "想说但在犹豫要不要说"
  suppressFollowUp = true
```

**5. normal（正常）— 默认**
```
信封:
  responseMode = 'normal'
  messagePattern = 'single'
  replyProbability = 1.0
  delayRange = [1s, 10s]
  maxMessages = 1
  emotionalTone = "" (不注入额外约束)
  suppressFollowUp = false
```

### 随机扰动

为避免确定性规则被用户摸透，每次评估加入微小随机扰动：
- `replyProbability ± 0.1`
- `delayRange` 各端 ± 20%
- 状态边界条件加 ±0.05 噪声

---

## Feature 3: Response Scheduler（收件箱解耦）

### 问题

当前架构：用户发消息 → `onResponse()` 立即处理 → 同步返回回复。
这使得"已读不回"和"延迟回复"无法实现。

### 方案

引入 **Inbox** 概念：用户消息先进 inbox，scheduler 在下一个 tick 决定是否回复。

```typescript
// 新增到 ImpulseState
interface InboxItem {
  messageId: string;
  content: string;
  receivedAt: number;
  processed: boolean;       // scheduler 已处理
  envelope?: BehavioralEnvelope;  // 处理时的行为信封快照
}

// ImpulseState 新增
inbox: InboxItem[];
```

### Scheduler 流程

每个 tick（evaluateAll 中调用）：

```
1. 检查 inbox 中未处理的消息
2. 对每条消息:
   a. 计算当前 BehavioralEnvelope
   b. 掷骰子: random() < replyProbability?
      - 否 → 标记 processed, 不回复 (已读不回)
      - 是 → 计算延迟: delay = random(delayRange[0], delayRange[1])
   c. 如果 delay 已过:
      - 调用 generateFn 生成回复 (带 envelope 约束)
      - 标记 processed
   d. 如果 delay 未到:
      - 跳过，等下一个 tick
3. 检查主动发起 (现有 impulse fire 逻辑)
   - fire 时也走 envelope 约束
```

### 与现有架构的兼容

**关键约束**：当前 OpenClaw 的消息流是同步的（HTTP request → response）。inbox 解耦需要异步推送能力。

**分阶段实现**：

**Phase A（V5.0）— 仅主动消息走 envelope**：
- `fireImpulse()` 生成消息时注入 envelope XML
- LLM 输出 MessagePlan（多条消息 + 延迟）
- 消息按 delay 分批推送（通过现有 WS/Telegram push）
- 被动回复（用户发消息后的回复）暂不改变

**Phase B（V5.1）— inbox 解耦**：
- `onResponse()` 不再同步回复，改为入 inbox
- scheduler 异步决定回复时机
- 需要 OpenClaw adapter 层支持异步推送
- 这是架构级变更，需要 adapter 配合

### 本次实现范围：Phase A

Phase A 不需要改变现有的 request-response 流程，只影响主动消息的生成方式。

---

## Feature 4: MessagePlan 输出格式

### LLM Prompt 注入

当 envelope 不是 `normal` 状态时，在 `formatInternalState()` 的 XML 中追加行为指令：

```xml
<behavioral_envelope>
  当前状态: 黏人
  表达方式: 把想法拆成2-3条短消息，像在微信聊天一样自然断句。
  情绪基调: 看到他回消息很开心，想分享今天的事情。
  约束: 每条消息不超过30字。消息之间有自然停顿。
</behavioral_envelope>
```

### LLM 输出解析

要求 LLM 在 `messagePattern != 'single'` 时输出特定格式：

```
[MSG]第一条消息内容[/MSG]
[MSG]第二条消息内容[/MSG]
[MSG]第三条消息内容[/MSG]
```

如果 LLM 没有按格式输出（降级处理）：整段文本作为单条消息发送。

### MessagePlan 类型

```typescript
export interface MessagePlan {
  messages: Array<{
    text: string;
    delayMs: number;    // 距上一条的延迟
  }>;
  envelope: BehavioralEnvelope;  // 快照，用于日志
}
```

### 延迟计算

```typescript
function computeMessageDelays(
  messages: string[],
  pattern: MessagePattern
): number[] {
  switch (pattern) {
    case 'burst':
      // 快速连发: 1-3秒间隔
      return messages.map((_, i) =>
        i === 0 ? 0 : 1000 + Math.random() * 2000
      );
    case 'fragmented':
      // 碎片化: 3-8秒间隔（模拟思考）
      return messages.map((_, i) =>
        i === 0 ? 0 : 3000 + Math.random() * 5000
      );
    case 'minimal':
    case 'single':
    default:
      return [0];
  }
}
```

---

## Feature 5: 角色卡行为模板

### 问题

状态评估器的规则是通用的。但不同角色的行为模式应该不同——一个傲娇角色的"冷战"和一个温柔角色的"冷战"表现完全不同。

### 方案

在 MetroidCard 中新增可选的行为模板覆盖：

```typescript
// MetroidCard 新增
behavioral?: {
  /** 状态覆盖：角色特定的状态行为 */
  stateOverrides?: Partial<Record<BehavioralState, {
    emotionalTone?: string;        // 覆盖默认的情绪描述
    replyProbabilityMod?: number;  // 加法修正 (-0.5 ~ +0.5)
    delayMod?: number;             // 延迟乘数 (0.5 ~ 3.0)
    preferredPattern?: MessagePattern;  // 偏好的消息模式
  }>>;
  /** 绝对不会做的事（硬约束） */
  neverDo?: string[];  // e.g., ["完全不回消息超过24小时", "用粗鲁的语气"]
  /** 一定会做的事（硬约束） */
  alwaysDo?: string[]; // e.g., ["最终一定会回消息", "生气时用表情包代替文字"]
};
```

### 示例：天生乐天且好奇心足的角色

```json
{
  "behavioral": {
    "stateOverrides": {
      "withdrawn": {
        "emotionalTone": "有点失落，但好奇心让你忍不住想知道对方在干嘛",
        "replyProbabilityMod": 0.3,
        "delayMod": 0.7
      },
      "cold_war": {
        "emotionalTone": "嘴上说不理你了，但其实一直在偷看消息",
        "replyProbabilityMod": 0.2,
        "preferredPattern": "minimal"
      },
      "clingy": {
        "emotionalTone": "超级开心！想把今天看到的所有有趣的事都告诉你",
        "preferredPattern": "burst"
      }
    },
    "neverDo": ["完全不回消息超过6小时"],
    "alwaysDo": ["最终一定会回消息", "好奇心驱动下会主动问问题"]
  }
}
```

### 示例：傲娇大小姐

```json
{
  "behavioral": {
    "stateOverrides": {
      "withdrawn": {
        "emotionalTone": "才不是在等你消息呢，只是刚好看到手机亮了",
        "replyProbabilityMod": -0.1,
        "delayMod": 2.0
      },
      "cold_war": {
        "emotionalTone": "哼，不理你了。（但其实很在意）",
        "replyProbabilityMod": -0.2,
        "preferredPattern": "minimal"
      },
      "clingy": {
        "emotionalTone": "才、才不是特意找你聊天的！只是刚好有话要说而已",
        "preferredPattern": "fragmented"
      }
    },
    "neverDo": ["直接表达喜欢", "承认自己在等消息"],
    "alwaysDo": ["口是心非", "用反话表达关心"]
  }
}
```

---

## 实现计划

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/types.ts` | +40 行 (BehavioralEnvelope, MessagePlan, behavioral card 类型) |
| `src/engines/proactive/index.ts` | +150 行 (状态评估器, envelope 注入, MessagePlan 解析) |
| `src/importers/st-card.ts` | +10 行 (behavioral 默认值) |
| `tests/proactive.test.ts` | +300 行 (V5 测试) |

### 不需要新文件，不需要 DB 迁移

- BehavioralEnvelope 是瞬时计算结果，不持久化
- MessagePlan 通过现有的 proactive_messages 表存储（content 字段存 JSON）
- behavioral 配置在 card JSON 中，无需新表

### 实现顺序

1. **types.ts** — 新增类型定义
2. **状态评估器** — `evaluateBehavioralState()` 方法
3. **envelope 注入** — 修改 `formatInternalState()` 和 `fireImpulse()`
4. **MessagePlan 解析** — 解析 LLM 输出的 `[MSG]...[/MSG]` 格式
5. **角色卡模板** — behavioral 字段处理
6. **ST 卡导入** — 默认 behavioral 配置
7. **测试** — 状态评估、envelope 注入、消息解析

### 测试计划

| Feature | Tests | 覆盖 |
|---------|-------|------|
| 状态评估器 | 8 | 5种状态判定 + 优先级 + 随机扰动 + 默认值 |
| envelope 注入 | 4 | XML 格式 + normal 不注入 + 角色覆盖 + neverDo |
| MessagePlan 解析 | 5 | MSG 标签解析 + 降级处理 + delay 计算 + burst/fragment |
| 角色卡模板 | 4 | stateOverrides + neverDo/alwaysDo + 默认值 + ST导入 |

### 验证

```bash
cd metroid && npx vitest run tests/proactive.test.ts
```

---

## 实现状态 (2026-02-24)

**Phase A (V5.0) — 已完成 ✅**

| 模块 | 状态 | 说明 |
|------|------|------|
| 类型定义 (`types.ts`) | ✅ | BehavioralState/ResponseMode/MessagePattern/BehavioralEnvelope/MessagePlan, MetroidCard.behavioral, ImpulseState.inbox, ProactiveMessage.delayMs |
| 状态评估器 (`proactive/index.ts`) | ✅ | `evaluateBehavioralState()` — 5种状态优先级判定 + 角色覆盖 + 随机扰动 |
| 反馈计数 (`proactive/index.ts`) | ✅ | `getRecentReactionCount()` — 24h内特定反应类型计数 |
| Envelope 注入 (`formatInternalState`) | ✅ | 非 normal 状态时追加 `<behavioral_envelope>` XML (~80 tokens) |
| MessagePlan 解析 (`fireImpulse`) | ✅ | `[MSG]...[/MSG]` 标签解析, 空消息过滤, maxMessages 截断 |
| 消息延迟 (`computeMessageDelay`) | ✅ | burst: 1-3s, fragmented: 3-8s |
| 多消息存储 (`fireImpulse`) | ✅ | 每条消息独立存入 DB, notifyMessage 携带 delayMs |
| Audit 日志 | ✅ | envelope snapshot (state, messagePattern, messageCount) 记入审计 |
| ST 卡导入 (`st-card.ts`) | ✅ | PNG/JSON 两条路径均添加 behavioral 默认值 |
| 测试 (`proactive.test.ts`) | ✅ | 21 个新测试 (8 状态评估 + 4 注入 + 5 解析 + 4 集成), 全部 191 测试通过 |

**Phase B (V5.1) — 未开始**

- inbox 解耦: 被动回复走 scheduler
- 需要 OpenClaw adapter 层支持异步推送

---

## 未来方向 (V6) — ✅ 已实现

> V6 已在 `866f1d3` 中实现，详见 [proactive-v6-design.md](./proactive-v6-design.md)

- ✅ **后台状态 LLM** — Haiku 级 analyzeFn 生成 inner monologue 和 unsent draft
- ✅ **unsent_draft 记忆** — 想说没说的话存入 inner_monologues 表，注入 `<unsent_thoughts>` 影响未来回复
- ✅ **多用户行为差异** — per-user relationship (attachment/trust/familiarity) 调制行为阈值
- ✅ **对话节奏适配** — EMA 追踪用户回复速度，动态调整 agent 延迟
- ⬜ **Phase B: inbox 解耦** — 被动回复也走 scheduler（待 V7）
