# Proactive Engine V7 — 记忆融合 × 已读不回

## 概述

V7 在 V6（关系感知内心世界）基础上完成三件事：

1. **V6 补全（Part C）** — 修复 V6 遗留的半成品：关系衰减、`event_detected` 独白触发、`ProactiveMessage.monologue` 填充、全类型独白回流、孤儿类型清理
2. **记忆融合（Part B）** — 打通 MemoryEngine 与 ProactiveEngine 的隔离墙，让主动消息有"记忆感"
3. **已读不回（Part A）** — 被动回复也走 behavioral envelope 评估，实现冷处理/犹豫/延迟回复

## 设计理念

V5 解决了"怎么说话"，V6 解决了"对谁说什么"。V7 解决的是"要不要回"和"想起了什么"。

关键原则：
- **渐进式改造** — Part C → B → A 顺序实现，每步可独立验证
- **adapter 兼容** — HTTP 同步接口保持可用，WS 支持 read_receipt / typing / delayed
- **零 LLM 开销** — 记忆注入和 inbox 评估都是确定性逻辑，不增加 LLM 调用

---

## Part C: V6 补全

### C1. `formatInternalState()` 修复

**问题**: `getUnconsumedDrafts.all(agentId, agentId)` 传了两次 agentId，SQL 期望 `(agent_id, user_id)`。

**修复**: 签名增加 `userId?: string` 参数，调用改为 `(agentId, userId ?? '')`。调用方 `fireImpulse()` 通过 `getAllRelationships` 查询最近互动用户传入。

### C2. 关系衰减 `decayRelationships()`

新增 `getAllRelationships` prepared statement 和 `decayRelationships()` 方法，在 `evaluateImpulse()` 每个 tick 调用。

衰减规则：
- 24 小时内不衰减（grace period）
- 超过 24h 后，指数衰减 `Math.pow(0.995, decayHours)`（每小时 ~0.5% 向零回归）
- familiarity 不衰减（认识了就是认识了）
- 仅当变化 > 0.001 时写入 DB（避免无意义写入）

### C3. `event_detected` 独白触发

在 `onResponse()` 的事件检测回调中，当 `confidence >= 0.7` 时自动生成 `event_detected` 类型独白。

### C4. `ProactiveMessage.monologue` 填充

`notifyMessage()` 新增 `monologue?: string` 参数。`fireImpulse()` 生成消息后同时生成伴随独白，通过 `notifyMessage()` 传递给回调。

### C5. 全类型独白回流

`formatInternalState()` 新增 `<recent_thoughts>` XML 段，展示最近 5 条非 `message_suppressed` 独白。新增 `getRecentNonSuppressedMonologues` prepared statement。

### C6. 清理孤儿类型

删除 `types.ts` 中的 `UnsentDraft` 接口（实际用 `inner_monologues` 表存储）。

---

## Part B: 记忆融合

### 架构变更

ProactiveEngine 构造函数新增 `memory: MemoryEngine | null` 参数（null 兼容测试场景）：

```typescript
constructor(db, identity, emotion, memory: MemoryEngine | null, audit, config)
```

`Metroid` 类传入 `this.memory`：

```typescript
this.proactive = new ProactiveEngine(
  this.db, this.identity, this.emotion, this.memory, this.audit, this.config
);
```

### MemoryEngine 新增方法

```typescript
/** V7 B2: 为主动消息上下文检索记忆（不走 prompt fragment 管线） */
async retrieveForContext(agentId: string, query: string, limit = 3): Promise<Memory[]> {
  const results = await this.retriever.retrieve({ agentId, text: query, limit });
  return results.map(r => r.memory);
}

/** V7 B2: 将事件编码为记忆 */
encodeEvent(agentId: string, content: string, sourceId: string): void {
  this.encoder.encode(agentId, content, sourceId);
}
```

注意：`encodeEvent` 签名简化为 `(agentId, content, sourceId)`，由调用方组装内容字符串。

### 主动消息注入相关记忆

`fireImpulse()` 中，生成 prompt 前查询相关记忆：

```typescript
if (this.memory) {
  const keywords = state.activeEvents.map(e => e.name.replace('inspiration:', '')).join(' ');
  if (keywords) {
    const memories = await this.memory.retrieveForContext(agentId, keywords, 3);
    if (memories.length > 0) {
      prompt += '\n<relevant_memories>\n' +
        memories.map(m => `  ${m.summary || m.content.slice(0, 100)}`).join('\n') +
        '\n</relevant_memories>';
    }
  }
}
```

### 关系事件写入记忆

`updateRelationshipViaLLM()` 中，当 `totalDelta > 0.1` 时写入 episodic memory：

```typescript
this.memory.encodeEvent(agentId,
  `关系变化(${userId}): attachment ${old}→${new}, trust ${old}→${new}。原因: ${reason}`,
  `rel-${agentId}-${userId}-${timestamp}`);
```

### 显著独白写入记忆

`generateInnerMonologue()` 中，`state_change` 和 `event_detected` 类型独白写入 semantic memory：

```typescript
this.memory.encodeEvent(agentId, content, monologueId);
```

---

## Part A: 已读不回（Inbox 解耦）

### ChatResult 扩展

```typescript
export interface ChatResult {
  response: string;
  timing: { totalMs: number; llmMs: number; compileMs: number; postProcessMs: number };
  tokenUsage: { promptTokens: number; completionTokens: number };
  usage?: LLMUsage;
  voiceHint?: { emotion: string; intensity: number; speed: number };
  fragmentSummary: Array<{ source: string; tokens: number }>;
  // V7: Inbox decoupling
  delayed?: boolean;
  delayMs?: number;
  suppressed?: boolean;
  suppressReason?: string;
  envelope?: BehavioralEnvelope;
}
```

### `Metroid.chat()` 改造

在 LLM 调用前评估 behavioral envelope（仅 enhanced 模式）：

1. 获取 `userId` 和 `envelope`
2. `cold_war` / `withdrawn` 状态下，`Math.random() > replyProbability` 时抑制回复
3. 抑制时：执行 `runSideEffects('')`（引擎仍学习用户消息），生成 suppressed reply 独白，返回空 response
4. `hesitant` / `withdrawn` 未抑制时：计算延迟 `delayMs`，标记 `delayed: true`
5. 所有结果附带 `envelope`

### `runSideEffects()` 提取

从 `chat()` 中提取为独立方法，接受空 response 也能执行：

```typescript
private async runSideEffects(response: string, context: EngineContext): Promise<void> {
  await this.compiler.onResponse(response, context);  // 触发所有 6 个引擎的 onResponse
  await this.audit.log({...});
}
```

即使 response 被 suppress，以下副作用仍然执行：
- EmotionEngine — 情绪更新
- MemoryEngine — 记忆编码
- ProactiveEngine — 事件检测、关系更新、节奏追踪
- GrowthEngine — 行为观察

### `generateSuppressedReply()`

```typescript
async generateSuppressedReply(
  agentId: string, userId: string, userMessage: string, envelope: BehavioralEnvelope
): Promise<void> {
  await this.generateInnerMonologue(agentId, userId, 'message_suppressed',
    `收到"${userMessage.slice(0, 50)}"但选择不回复。状态: ${envelope.state}`);
}
```

### 回复策略矩阵

| Envelope State | 回复策略 | HTTP 行为 | WS 行为 |
|---|---|---|---|
| `normal`, `clingy` | 立即回复 | 同步返回 response | 同步返回 response |
| `hesitant` | 生成但延迟 | 返回 `delayed: true, delayMs` | 发送 typing → await delay → 发送 response |
| `withdrawn` | 可能不回 | 返回 `suppressed: true` 或延迟回复 | 发送 read_receipt 或延迟回复 |
| `cold_war` | 大概率不回 | 返回 `suppressed: true` | 发送 read_receipt（已读不回） |

### WS Adapter

- **suppressed**: 发送 `{ type: 'read_receipt', messageId, envelope, suppressReason }`
- **delayed**: 发送 `{ type: 'typing', delayMs }` → `await setTimeout(delayMs)` → 发送正常 `chat_response`
- **normal**: `chat_response` 附带 `envelope` 和 `delayed` 字段

### HTTP Adapter

同步返回，response JSON 新增字段：`delayed`, `delayMs`, `suppressed`, `suppressReason`, `envelope`。

---

## API 变更

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/agents/:id/chat` | response 新增 `delayed`, `delayMs`, `suppressed`, `suppressReason`, `envelope` |
| WS | `chat_response` | 新增 `delayed`, `envelope` 字段 |
| WS | `read_receipt` | 新增消息类型：已读不回时发送 |
| WS | `typing` | 新增消息类型：延迟回复前发送（含 `delayMs`） |

---

## 文件变更

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/types.ts` | -10 行 | 删除 UnsentDraft |
| `src/engines/proactive/index.ts` | +111 行 | 衰减、event_detected、独白回流、记忆注入、suppressedReply |
| `src/engines/memory/index.ts` | +10 行 | `retrieveForContext()`, `encodeEvent()` |
| `src/index.ts` | +47 行 | ChatResult 扩展, chat() 改造, runSideEffects() |
| `src/adapter/http.ts` | +22 行 | HTTP/WS 响应扩展 |

总计: 5 文件, +190/-33 行, 0 新文件

---

## 实现状态

**V7 实现完成** (2026-02-24)

- Part C (V6 补全): 6/6 — C1~C6 全部修复
- Part B (记忆融合): 3/3 — B1~B3 全部实现
- Part A (已读不回): 5/5 — A1~A5 全部实现
- 类型检查: 零新增错误 (4 个预存错误不变)
- Commit: `fb89ba4`

---

## 未来方向 (V8)

- **多用户关系图** — agent 对不同用户的关系影响彼此（嫉妒、偏心）
- **独白影响情绪** — 内心独白反馈到情绪系统，形成闭环
- **对话策略学习** — 从 reaction 数据学习最优回复策略
- **群聊行为** — 多人对话中的发言时机和角色定位
