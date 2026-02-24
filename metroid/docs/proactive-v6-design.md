# Proactive Engine V6 — 关系感知的内心世界

## 概述

V6 在 V5 (行为信封) 基础上解决两个结构性限制：

1. **无状态评估** — V5 的行为状态每次 tick 从零计算，没有状态记忆。agent 可以在一个 tick 内从 cold_war 跳到 normal，只因为冲突事件衰减到阈值以下，而没有任何和解事件。
2. **无用户区分** — V5 的所有行为参数（阈值、衰减率、容忍度）对所有用户一视同仁。真人对亲密的人和陌生人的反应完全不同。

V6 引入：
- **Per-user 关系模型** — attachment/trust/familiarity 三维关系状态
- **LLM 驱动的关系更新** — 每轮对话后用轻量 LLM 评估关系变化
- **内心独白系统** — 事件驱动的内心想法生成（state_change, message_received, message_suppressed, ambient）
- **未发送草稿** — 想说但忍住的话，注入未来 prompt 上下文
- **对话节奏追踪** — EMA 追踪用户回复速度，调节 agent 延迟

## 设计理念

V5 解决了"怎么说话"。V6 解决的是"对谁说什么"和"没说出口的话"。

关键原则：
- **轻量 LLM** — 关系更新和独白生成用 analyzeFn（Haiku 级），不影响主对话
- **关系调制** — attachment 影响行为阈值，而非替换 V5 的状态评估逻辑
- **异步不阻塞** — 关系更新和独白生成都是 fire-and-forget，不阻塞 onResponse

## 架构总览

```
┌──────────────────────────────────────────────┐
│  V5 已有: BehavioralEnvelope 确定性评估        │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  V6: Relationship Modulation                  │
│  输入: userId → user_relationships 表          │
│  输出: thresholdShift, toleranceBonus          │
│  效果: 修改 V5 状态判定的阈值参数               │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  V6: Inner Monologue Generator                │
│  触发: state_change / message_received /       │
│        message_suppressed / ambient            │
│  输出: 20-50字内心独白 → inner_monologues 表    │
│  推送: WS { type: 'monologue', ... }          │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  V6: Unsent Draft Injection                   │
│  来源: trigger='message_suppressed' 的独白     │
│  注入: formatInternalState → <unsent_thoughts> │
│  效果: LLM 知道 agent 之前想说但没说的话        │
└──────────────────────────────────────────────┘
```

---

## Feature 1: Per-User 关系模型

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS user_relationships (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT NOT NULL,
  attachment REAL NOT NULL DEFAULT 0,   -- -1 ~ +1, 情感纽带强度
  trust REAL NOT NULL DEFAULT 0,        -- -1 ~ +1, 可靠性/安全感
  familiarity REAL NOT NULL DEFAULT 0,  -- 0 ~ 1, 了解程度
  last_interaction TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, user_id)
);
```

### 类型定义

```typescript
export interface UserRelationship {
  agentId: string;
  userId: string;
  attachment: number;      // -1 ~ +1
  trust: number;           // -1 ~ +1
  familiarity: number;     // 0 ~ 1
  lastInteraction: number;
  updatedAt: number;
}
```

### 关系更新机制

每轮对话后（`onResponse`），异步调用 `updateRelationshipViaLLM()`：

```
prompt → analyzeFn:
  "分析这段对话对关系的影响。
   当前关系: attachment=0.30, trust=0.20
   用户说: "今天好累啊"
   角色回复: "辛苦了，要不要我陪你聊聊？"
   请以JSON回复: {"attachment_delta": 0.05, "trust_delta": 0.02, "reason": "关心对方"}"

delta × volatility → 新值
familiarity += 0.01 (每次交互缓慢增长)
```

`relationshipVolatility`（默认 0.3）控制关系变化速度。

### 关系对行为的调制

关系通过修改 V5 状态评估的阈值参数来影响行为：

| 参数 | 默认值 | 效果 |
|------|--------|------|
| `thresholdShift` | `attachment × 0.1` | cold_war 阈值上移（更难触发），clingy 阈值下移（更易触发） |
| `toleranceBonus` | `floor(attachment × 2)` | withdrawn 需要更多被忽略次数才触发 |

示例：attachment = 0.8 的用户
- cold_war: emotionDist 需要 > 0.88（而非 0.8）才触发
- withdrawn: 需要被忽略 5 次（而非 3 次）才触发
- clingy: impulseValue > 0.42（而非 0.5）就能触发

---

## Feature 2: 内心独白系统

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS inner_monologues (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT,
  trigger TEXT NOT NULL CHECK(trigger IN (
    'state_change','message_received','message_suppressed',
    'event_detected','ambient'
  )),
  content TEXT NOT NULL,
  emotion_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 触发点

| 触发类型 | 触发位置 | 条件 |
|----------|----------|------|
| `state_change` | `evaluateBehavioralState()` | 计算出的状态与上次不同 |
| `message_received` | `onResponse()` | 每次收到用户消息 |
| `message_suppressed` | `evaluateImpulse()` | impulse 被抑制（想说但没说） |
| `ambient` | `evaluateImpulse()` | 每 10 个 tick 且 memoryPressure > 0.2 |

### 生成方式

通过 `analyzeFn`（Haiku 级 LLM）生成 20-50 字的第一人称内心独白：

```
prompt:
  "你是阿凛。基于以下情境，写一句内心独白（20-50字，第一人称，不要引号）。
   情境: 状态从normal变为cold_war
   最近的想法: 他怎么又不回我了 / 算了不想了"

output: "明明说好了不生气的，可是看到他那条消息还是忍不住难过"
```

### WS 推送

每条独白生成后通过 WebSocket 推送：

```json
{ "type": "monologue", "id": "mono-xxx-123", "trigger": "state_change", "content": "...", "createdAt": 1708xxx }
```

---

## Feature 3: 未发送草稿注入

### 机制

`trigger = 'message_suppressed'` 的独白被视为"未发送草稿"。在 `formatInternalState()` 中，未消费的草稿被注入 prompt：

```xml
<unsent_thoughts>
  [10分钟前] 想说"你怎么还不回我"但忍住了
  [30分钟前] 想分享今天看到的猫但觉得你可能不感兴趣
</unsent_thoughts>
```

草稿注入后标记为 `[consumed]`，不会重复注入。

### 效果

LLM 在生成下一条主动消息时，能看到 agent 之前想说但没说的话，使得对话更连贯、更有"积压感"。

---

## Feature 4: 对话节奏追踪

### EMA 追踪

在 `onResponse()` 中，用指数移动平均追踪用户回复速度：

```typescript
const alpha = 0.3;
state.conversationTempo = state.conversationTempo === 0
  ? replyMs
  : alpha * replyMs + (1 - alpha) * state.conversationTempo;
```

仅追踪 < 1 小时的回复间隔（超过视为新会话）。

### 延迟调制

在 `evaluateBehavioralState()` 中，根据 tempo 调整 delayRange：

```typescript
const tempoRatio = conversationTempo / 60_000; // 归一化到分钟
const tempoMul = Math.max(0.3, tempoRatio);
delayRange = [delayRange[0] * tempoMul, delayRange[1] * tempoMul];
```

效果：用户回复快 → agent 也回复快；用户回复慢 → agent 也放慢节奏。

---

## Feature 5: 角色卡配置

### MetroidCard 新增字段

```typescript
relationship?: {
  attachmentEffect?: {
    decayRateMultiplier?: number;   // 默认 0.5
    thresholdShift?: number;        // 默认 0.1
    toleranceBonus?: number;        // 默认 2
  };
  relationshipVolatility?: number;  // 默认 0.3
};
```

ST 卡导入时自动添加默认值 `{ relationshipVolatility: 0.3 }`。

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/agents/:id/relationship/:userId` | 获取 per-user 关系状态 |
| GET | `/agents/:id/monologue?limit=10` | 获取最近内心独白 |
| GET | `/agents/:id/envelope?userId=X` | 获取当前行为信封（可选 userId 关系调制） |

---

## 文件变更

| 文件 | 变更量 | 说明 |
|------|--------|------|
| `src/db/schema.sql` | +25 行 | 2 新表: user_relationships, inner_monologues |
| `src/types.ts` | +50 行 | UserRelationship, InnerMonologue, MonologueTrigger, UnsentDraft, relationship config |
| `src/engines/proactive/index.ts` | +200 行 | 关系 CRUD, LLM 更新, 独白生成, 4 触发点, 草稿注入, 节奏追踪 |
| `src/adapter/http.ts` | +30 行 | 3 新端点 + WS 独白推送 |
| `src/importers/st-card.ts` | +8 行 | relationship 默认值 (两条导入路径) |
| `src/index.ts` | +20 行 | onMonologue, getRelationship, getRecentMonologues, getBehavioralEnvelope |
| `tests/proactive.test.ts` | +300 行 | 14 新测试 (关系 5 + 独白 3 + 节奏 3 + LLM 更新 3) |

总计: 7 文件, +654 行, 0 新文件, 2 新 DB 表

---

## 测试

```bash
cd metroid && npx vitest run tests/proactive.test.ts
# 205 tests passed (191 existing + 14 new V6)
```

| 测试组 | 数量 | 覆盖 |
|--------|------|------|
| 关系状态 | 5 | 默认值, DB 持久化, cold_war/withdrawn/clingy 阈值调制 |
| 内心独白 | 3 | DB 存储, WS 通知, ambient 定时触发 |
| 对话节奏 | 3 | EMA 追踪, 延迟调制, 零值不调制 |
| 关系 LLM 更新 | 3 | prompt 格式, volatility 缩放, familiarity 增长 |

---

## 未来方向 (V7)

- **关系衰减** — 长时间不互动时 attachment/trust 缓慢衰减
- **多用户关系图** — agent 对不同用户的关系影响彼此（嫉妒、偏心）
- **独白影响情绪** — 内心独白反馈到情绪系统，形成闭环
- **Phase B inbox 解耦** — 被动回复也走 scheduler + 关系调制
