# Proactive Engine V7 — 记忆融合 × 已读不回

## 概述

V7 在 V6（关系感知内心世界）基础上完成三件事：

1. **V6 补全（Part C）** — 修复 V6 遗留的半成品：未触发的 `event_detected`、未填充的 `ProactiveMessage.monologue`、未实现的关系衰减、孤儿类型清理
2. **记忆融合（Part B）** — 打通 MemoryEngine 与 ProactiveEngine 的隔离墙，让主动消息有"记忆感"
3. **已读不回（Part A）** — Phase B inbox 解耦，被动回复也走 behavioral envelope，实现真正的冷处理/犹豫/延迟回复

## 设计理念

V5 解决了"怎么说话"，V6 解决了"对谁说什么"。V7 解决的是"要不要回"和"想起了什么"。

关键原则：
- **渐进式改造** — Part C → B → A 顺序实现，每步可独立验证
- **adapter 兼容** — HTTP 同步接口保持可用，inbox 解耦仅对 WS 客户端生效
- **零 LLM 开销** — 记忆注入和 inbox 评估都是确定性逻辑，不增加 LLM 调用

---

## Part C: V6 补全

### C1. 关系衰减

长时间不互动时 attachment/trust 缓慢衰减。在 `evaluateImpulse()` 的每个 tick 中检查：

```typescript
// 在 evaluateImpulse() 中，每个 tick 检查所有关系
private decayRelationships(agentId: string): void {
  const rows = this.stmts.getAllRelationships.all(agentId);
  const now = this.now();
  for (const row of rows) {
    const hoursSince = (now - new Date(row.last_interaction).getTime()) / 3_600_000;
    if (hoursSince < 24) continue; // 24小时内不衰减
    const decayRate = 0.005; // 每小时衰减 0.5%
    const decay = decayRate * (hoursSince - 24);
    const newAttachment = Math.max(-0.5, row.attachment - decay * Math.sign(row.attachment));
    const newTrust = Math.max(-0.5, row.trust - decay * Math.sign(row.trust));
    if (Math.abs(newAttachment - row.attachment) > 0.001 || Math.abs(newTrust - row.trust) > 0.001) {
      this.stmts.upsertRelationship.run(agentId, row.user_id, newAttachment, newTrust, row.familiarity);
    }
  }
}
```

衰减规则：
- 24 小时内不衰减（正常对话间隔）
- 超过 24 小时后，每小时衰减 0.5%（向零回归）
- attachment 最低衰减到 -0.5（不会因为不说话就恨你）
- familiarity 不衰减（认识了就是认识了）

### C2. `event_detected` 触发

在 `detectEventsWithLLM()` 确认事件后，生成内心独白：

```typescript
// 在 onResponse() 的事件检测回调中
.then(confirmedEvents => {
  for (const e of confirmedEvents) {
    this.addActiveEvent(context.agentId, e.name, e.intensity, 0.5, e.relevance);
    // V7: 触发 event_detected 独白
    if (e.confidence >= 0.7) {
      this.generateInnerMonologue(context.agentId, context.message.author.id,
        'event_detected', `检测到事件: ${e.name}，强度${e.intensity.toFixed(1)}`);
    }
  }
})
```

### C3. `ProactiveMessage.monologue` 填充

在 `fireImpulse()` 生成消息时，同时生成伴随独白并关联：

```typescript
// fireImpulse() 中，生成消息后
const monologue = await this.generateInnerMonologue(agentId, undefined, 'message_received',
  `主动发了消息: "${content.slice(0, 50)}"`);
// 通知时附带 monologue
this.notifyMessage(agentId, firstId, 'impulse', triggerType, msg.text, msg.delayMs, monologue ?? undefined);
```

### C4. 全类型独白回流

当前只有 `message_suppressed` 的独白注入 prompt。V7 扩展为所有类型的最近独白都可见：

在 `formatInternalState()` 中，`<unsent_thoughts>` 之前新增：

```xml
<recent_thoughts>
  [5分钟前] 他好像心情不太好（state_change）
  [12分钟前] 收到消息的时候有点开心（message_received）
</recent_thoughts>
```

实现：查询最近 5 条非 suppressed 独白，注入为 `<recent_thoughts>`。

### C5. 清理孤儿类型

- 删除 `types.ts` 中的 `UnsentDraft` 接口（实际用 `inner_monologues` 表存储，不需要独立类型）

---

## Part B: 记忆融合

### 问题

当前 ProactiveEngine 和 MemoryEngine 完全隔离：
- 主动消息生成时，`formatInternalState()` 只注入情绪轨迹和 active events
- 没有任何历史记忆（"上次聊到的话题"、"她说过喜欢猫"）
- 关系变化不写入记忆（"她连续三天没理我"不会被记住）

### B1. 主动消息注入相关记忆

在 `fireImpulse()` 中，生成 prompt 前查询相关记忆：

```typescript
private async getRelevantMemoriesForImpulse(agentId: string, state: ImpulseState): Promise<string> {
  // 构建查询：用 active events + 最近独白作为检索关键词
  const keywords: string[] = [];
  for (const e of state.activeEvents) {
    keywords.push(e.name.replace('inspiration:', ''));
  }
  const recentMonologues = this.stmts.getRecentMonologues.all(agentId, 3) as any[];
  for (const m of recentMonologues) {
    keywords.push(m.content.slice(0, 30));
  }
  if (keywords.length === 0) return '';

  const query = keywords.join(' ');
  const memories = this.memoryEngine.retrieveForContext(agentId, query, 3);
  if (memories.length === 0) return '';

  let xml = '<relevant_memories>\n';
  for (const m of memories) {
    xml += `  ${m.summary || m.content.slice(0, 100)}\n`;
  }
  xml += '</relevant_memories>';
  return xml;
}
```

需要 MemoryEngine 暴露新方法：

```typescript
// MemoryEngine 新增公共方法
retrieveForContext(agentId: string, query: string, limit: number): Memory[]
```

这个方法复用现有的 `retriever.retrieve()` 逻辑，但不走 prompt fragment 管线。

### B2. 关系事件写入记忆

在 `updateRelationshipViaLLM()` 中，当关系发生显著变化时写入 episodic memory：

```typescript
// 在 updateRelationshipViaLLM() 中，delta 超过阈值时
const totalDelta = Math.abs(parsed.attachment_delta) + Math.abs(parsed.trust_delta);
if (totalDelta > 0.1) {
  this.memoryEngine.encodeEvent(agentId, {
    type: 'episodic',
    content: `与${userId}的关系变化: ${parsed.reason}。attachment ${parsed.attachment_delta > 0 ? '+' : ''}${parsed.attachment_delta.toFixed(2)}, trust ${parsed.trust_delta > 0 ? '+' : ''}${parsed.trust_delta.toFixed(2)}`,
    importance: Math.min(1, totalDelta * 3),
    keywords: ['relationship', userId, parsed.reason],
  });
}
```

需要 MemoryEngine 暴露新方法：

```typescript
// MemoryEngine 新增公共方法
encodeEvent(agentId: string, event: {
  type: MemoryType;
  content: string;
  importance: number;
  keywords: string[];
}): void
```

### B3. 显著独白写入记忆

`state_change` 和 `event_detected` 类型的独白写入 semantic memory：

```typescript
// 在 generateInnerMonologue() 中
if ((trigger === 'state_change' || trigger === 'event_detected') && content) {
  this.memoryEngine.encodeEvent(agentId, {
    type: 'semantic',
    content: `内心想法: ${content}`,
    importance: 0.4,
    keywords: [trigger, ...(userId ? [userId] : [])],
  });
}
```

### B4. 架构变更

ProactiveEngine 构造函数需要接收 MemoryEngine 引用：

```typescript
constructor(
  private db: Database.Database,
  private identity: IdentityEngine,
  private emotion: EmotionEngine,
  private memory: MemoryEngine,  // V7: 新增
  private audit: AuditLog,
  private config: MetroidConfig,
)
```

`Metroid` 类中的初始化顺序调整：

```typescript
this.proactive = new ProactiveEngine(
  this.db, this.identity, this.emotion, this.memory, this.audit, this.config
);
```

---

## Part A: 已读不回（Inbox 解耦）

### 问题

当前被动回复（用户发消息 → agent 回复）完全绕过 behavioral envelope：
- `cold_war` 状态下用户发消息，agent 依然秒回完整回复
- `withdrawn` 状态下 agent 不会延迟回复
- `hesitant` 状态下 agent 不会犹豫

这意味着 V5 的行为信封只影响了一半的交互（主动消息），被动回复完全不受控。

### 设计方案

**核心思路**：`Metroid.chat()` 在生成回复前先评估 behavioral envelope，根据状态决定回复策略。

**三种回复模式**：

| Envelope State | 回复策略 | HTTP 行为 | WS 行为 |
|---|---|---|---|
| `normal`, `clingy` | 立即回复 | 同步返回 response | 同步返回 response |
| `hesitant` | 生成但延迟 | 返回 `{ delayed: true, delayMs, content }` | 发送 typing → 延迟后推送 |
| `withdrawn` | 可能不回 | 返回 `{ suppressed: true, reason }` 或延迟回复 | 发送 read_receipt → 可能不回 |
| `cold_war` | 大概率不回 | 返回 `{ suppressed: true, reason }` | 已读不回 |

### ChatResult 扩展

```typescript
export interface ChatResult {
  response: string;
  // ... existing fields ...
  // V7: Inbox decoupling
  delayed?: boolean;           // response generated but should be delivered later
  delayMs?: number;            // suggested delay before showing response
  suppressed?: boolean;        // response was suppressed (agent chose not to reply)
  suppressReason?: string;     // why (for debug/UI)
  envelope?: BehavioralEnvelope; // the envelope that was evaluated
}
```

### Metroid.chat() 改造

```typescript
async chat(agentId: string, message: MetroidMessage, history: MetroidMessage[] = []): Promise<ChatResult> {
  const agent = this.identity.getAgent(agentId);

  // V7: Evaluate envelope BEFORE generating response
  const userId = message.author.id;
  const envelope = this.proactive.evaluateBehavioralState(agentId, agent!, userId);

  // V7: Suppression check
  if (envelope.state === 'cold_war' || envelope.state === 'withdrawn') {
    const shouldReply = Math.random() < envelope.replyProbability;
    if (!shouldReply) {
      // Still run side effects (emotion update, event detection, etc.)
      await this.runSideEffects(agentId, message, history, '');
      // Generate unsent draft
      this.proactive.generateSuppressedReply(agentId, userId, message.content, envelope);
      return {
        response: '',
        suppressed: true,
        suppressReason: envelope.state,
        envelope,
        timing: { totalMs: 0, llmMs: 0, compileMs: 0, postProcessMs: 0 },
        tokenUsage: { promptTokens: 0, completionTokens: 0 },
        fragmentSummary: [],
      };
    }
  }

  // Normal generation path (existing code)
  const result = await this.generateResponse(agentId, message, history, agent!);

  // V7: Delay annotation
  if (envelope.state === 'hesitant' || envelope.state === 'withdrawn') {
    const [minDelay, maxDelay] = envelope.delayRange;
    result.delayed = true;
    result.delayMs = minDelay + Math.random() * (maxDelay - minDelay);
  }

  result.envelope = envelope;
  return result;
}
```

### 新方法：`generateSuppressedReply()`

当 agent 选择不回复时，生成一条"想说但没说的话"作为 unsent draft：

```typescript
async generateSuppressedReply(
  agentId: string, userId: string, userMessage: string, envelope: BehavioralEnvelope
): Promise<void> {
  await this.generateInnerMonologue(agentId, userId, 'message_suppressed',
    `收到"${userMessage.slice(0, 50)}"但选择不回复。状态: ${envelope.state}，回复概率: ${(envelope.replyProbability * 100).toFixed(0)}%`);
}
```

### WS Adapter 改造

```typescript
// wsHandleMessage 中的 chat 处理
if (msg.type === 'chat') {
  const result = await metroid.chat(client.agentId, userMsg, history);

  if (result.suppressed) {
    // 已读不回：发送已读回执但不发送回复
    wsSend(client, {
      type: 'read_receipt',
      messageId: userMsg.id,
      envelope: { state: result.envelope?.state },
    });
    return;
  }

  if (result.delayed && result.delayMs) {
    // 延迟回复：先发 typing，延迟后发回复
    wsSend(client, { type: 'typing', agentId: client.agentId });
    setTimeout(() => {
      wsSend(client, {
        type: 'chat_response',
        response: result.response,
        delayed: true,
        delayMs: result.delayMs,
        envelope: { state: result.envelope?.state },
        // ... other fields
      });
    }, result.delayMs);
    return;
  }

  // 正常回复（现有逻辑）
  wsSend(client, { type: 'chat_response', response: result.response, ... });
}
```

### HTTP Adapter 行为

HTTP 端点保持同步返回，但在 response 中包含 envelope 信息：

```json
// suppressed 时
{ "response": "", "suppressed": true, "suppressReason": "cold_war", "envelope": { "state": "cold_war" } }

// delayed 时
{ "response": "回复内容", "delayed": true, "delayMs": 45000, "envelope": { "state": "hesitant" } }

// normal 时（不变）
{ "response": "回复内容", "envelope": { "state": "normal" } }
```

客户端（OpenClaw bot）根据 `delayed` / `suppressed` 字段决定是否/何时发送消息。

### 副作用保证

即使 response 被 suppress，以下副作用仍然执行：
- EmotionEngine.onResponse() — 情绪更新
- MemoryEngine.onResponse() — 记忆编码
- ProactiveEngine.onResponse() — 事件检测、关系更新、节奏追踪
- GrowthEngine.onResponse() — 行为观察

需要将 `PromptCompiler.onResponse()` 拆分为 `runSideEffects()` 方法，接受空 response 时也能执行。

---

## API 变更

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/agents/:id/chat` | response 新增 `delayed`, `delayMs`, `suppressed`, `suppressReason`, `envelope` 字段 |
| GET | `/agents/:id/relationship` | 新增：获取 agent 的所有关系列表 |
| WS | `chat_response` | 新增 `delayed`, `envelope` 字段 |
| WS | `read_receipt` | 新增消息类型：已读不回时发送 |
| WS | `typing` | 新增消息类型：延迟回复前发送 |

---

## 文件变更

| 文件 | 变更量 | 说明 |
|------|--------|------|
| `src/types.ts` | +15 行, -10 行 | 删除 UnsentDraft, ChatResult 扩展, MemoryEngine 新方法类型 |
| `src/engines/proactive/index.ts` | +120 行 | 关系衰减, event_detected 触发, 独白回流, 记忆注入, generateSuppressedReply |
| `src/engines/memory/index.ts` | +30 行 | retrieveForContext(), encodeEvent() 公共方法 |
| `src/index.ts` | +60 行 | chat() 改造, runSideEffects(), ProactiveEngine 构造函数变更 |
| `src/adapter/http.ts` | +25 行 | chat response 扩展, read_receipt/typing WS 消息 |
| `tests/proactive.test.ts` | +200 行 | Part C/B/A 测试 |

总计: 6 文件, ~460 行变更, 0 新文件

---

## 实现顺序

### Phase 1: V6 补全（Part C）
1. C5: 删除 `UnsentDraft` 孤儿类型
2. C1: 关系衰减（新 prepared statement + decayRelationships 方法）
3. C2: `event_detected` 触发（onResponse 事件回调中添加）
4. C3: `ProactiveMessage.monologue` 填充
5. C4: 全类型独白回流（formatInternalState 扩展）

### Phase 2: 记忆融合（Part B）
6. B4: ProactiveEngine 构造函数接收 MemoryEngine
7. MemoryEngine 新增 `retrieveForContext()` 和 `encodeEvent()`
8. B1: 主动消息注入相关记忆
9. B2: 关系事件写入记忆
10. B3: 显著独白写入记忆

### Phase 3: 已读不回（Part A）
11. ChatResult 类型扩展
12. `Metroid.chat()` 改造（envelope 评估 + 抑制逻辑）
13. `runSideEffects()` 提取
14. `generateSuppressedReply()` 方法
15. WS adapter 改造（read_receipt, typing, delayed delivery）
16. HTTP adapter response 扩展

### Phase 4: 测试
17. Part C 测试（关系衰减 3 + event_detected 2 + 独白回流 2）
18. Part B 测试（记忆注入 3 + 记忆写入 3）
19. Part A 测试（suppression 3 + delay 3 + side effects 2 + WS 2）

---

## 测试计划

### Part C 测试（7 个）
- 关系衰减：24h 内不衰减 / 超过 24h 缓慢衰减 / familiarity 不衰减
- event_detected：高置信度事件触发独白 / 低置信度不触发
- 独白回流：recent_thoughts 注入 formatInternalState / 最多 5 条

### Part B 测试（6 个）
- 记忆注入：有 active events 时查询记忆 / 无事件时不查询 / 记忆格式正确
- 记忆写入：关系显著变化写入 episodic / state_change 独白写入 semantic / 小变化不写入

### Part A 测试（10 个）
- Suppression：cold_war 状态大概率 suppress / withdrawn 状态可能 suppress / normal 不 suppress
- Delay：hesitant 状态返回 delayed=true / delayMs 在 envelope.delayRange 内
- Side effects：suppress 时仍执行情绪更新 / suppress 时仍执行记忆编码
- WS：suppress 时发送 read_receipt / delay 时先发 typing 再发 response
- 回归：normal 状态行为不变 / clingy 状态行为不变

总计: 23 个新测试

---

## 验证

```bash
cd metroid && npx vitest run tests/proactive.test.ts
# 预期: 205 existing + 23 new = 228 tests passed
```

## 实现状态

**V7 实现完成** (2026-02-24)

- Part C (V6 补全): 6/6 完成 — C1~C6 全部修复
- Part B (记忆融合): 3/3 完成 — B1~B3 全部实现
- Part A (已读不回): 5/5 完成 — A1~A5 全部实现
- 类型检查: 零新增错误 (4 个预存错误不变)
- 变更统计: +190/-33 across 5 files

---

## 未来方向 (V8)

- **多用户关系图** — agent 对不同用户的关系影响彼此（嫉妒、偏心）
- **独白影响情绪** — 内心独白反馈到情绪系统，形成闭环
- **对话策略学习** — 从 reaction 数据学习最优回复策略
- **群聊行为** — 多人对话中的发言时机和角色定位
