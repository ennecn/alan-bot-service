# Proactive Engine V4 — 行为动力学设计文档

## 概述

V4 在 V3 (去重/反馈/事件检测) 基础上增加四个心理学特性，让 agent 的行为模式更接近真实人类。所有特性 opt-in，通过 agent card 配置启用，现有卡片零影响。

## 设计理念

V1-V3 解决了"什么时候说话"和"说什么"的问题。V4 解决的是"为什么想说话"——给 impulse 系统注入更丰富的心理动机。

核心隐喻：
- **认知过滤器** → 每个人对同一件事的感受不同
- **情绪蓄水池** → 压力不会凭空消失，会积累到临界点
- **自我反馈** → 被回应会开心，被忽略会失落
- **灵感系统** → 牛顿的苹果——随机种子 × 准备好的心智 = 顿悟

## Feature 1: 认知过滤器 (Cognitive Filter)

### 问题
所有 agent 对同一事件的反应强度相同。一个敏感角色和一个豁达角色看到"冲突"事件，intensity 完全一样。

### 方案
```typescript
// MetroidCard.emotion
eventSensitivity?: Record<string, number>; // 事件名 → 强度乘数
```

在 `addActiveEvent()` 中查找 sensitivity 并乘以 intensity：
```
intensity = min(1, intensity × sensitivity)
```

### 示例
```json
{
  "eventSensitivity": {
    "conflict": 1.5,      // 对冲突高度敏感
    "celebration": 0.3,    // 对庆祝反应淡漠
    "loneliness": 2.0      // 极度怕孤独
  }
}
```

### 影响范围
仅 `addActiveEvent()` 一处，3 行代码。未配置的事件默认 1.0。

## Feature 2: 情绪蓄水池 (Memory Pool + Breach)

### 问题
V3 的 `emotion_pressure` 信号是瞬时的——当前情绪偏离基线就有激活，回到基线就消失。但现实中，长时间的情绪偏离会产生"积压"效应，即使短暂回到基线，积压不会立刻消失。

### 方案

**漏积分器 (Leaky Integrator)**：
```
pressure += emotionDistance × dtHours - decayRate × dtHours
clamp to [0, 2]
```

- `emotionDistance`: 当前 PAD 与 baseline 的欧几里得距离
- `decayRate`: 被动衰减速率 (默认 0.02/hour)
- 情绪偏离时积压上升，回归时缓慢衰减

**决堤信号 (Memory Breach)**：
```
activation = (pressure - threshold) / threshold  // smooth ramp
clamp to [0, 1]
```

当 pressure 超过 threshold (默认 0.7) 时，`memory_breach` 信号开始贡献 impulse gain。

### 新增类型
```typescript
// ImpulseState
memoryPressure: number;           // 0-2
lastMemoryPressureTime: number;

// ImpulseSignal.type
'memory_breach'

// ImpulseConfig
memoryBreachThreshold?: number;      // 默认 0.7
memoryPressureDecayRate?: number;    // 默认 0.02
```

### Prompt 输出
当 pressure > 0.1 时，`formatInternalState()` 在 trigger_context 中显示：
```xml
<trigger_context>
    情绪积压: 85%
</trigger_context>
```

## Feature 3: 自我行为反馈回路 (Self-Action Feedback)

### 问题
Agent 发出主动消息后，不知道这条消息的"命运"。V3 的反馈回路只调整 threshold，不影响 agent 的情绪状态。

### 方案

**发送后**：`fireImpulse()` 成功后注入 `awaiting_response` 事件 (intensity=0.3)

**被回应**：`detectReaction()` 检测到 engaged 时注入 `response_positive` 事件
```
intensity = max(0.2, 0.6 × (1 - latencyMs / 30min))
```
回复越快，正面反馈越强。

**被忽略**：`markStaleAsIgnored()` 检测到超时时注入 `message_ignored` 事件 (intensity=0.4)

### 新增类型
```typescript
// ImpulseState
awaitingResponse: boolean;
awaitingMessageId?: string;
```

### 行为效果
- 被回应 → 正面事件 → 下次更愿意主动
- 被忽略 → 负面事件 → 下次更犹豫（配合 V3 的 threshold 调整）

## Feature 4: 灵感系统 (Inspiration Spark + Resonance)

### 问题
Agent 的主动消息总是由外部事件或沉默驱动。缺少"灵光一闪"的随机性——人类会突然想到一个话题，不需要外部触发。

### 方案

**Spark Pool**：agent card 配置一组主题关键词
```json
{
  "sparkPool": ["月亮", "远方", "咖啡", "星空", "旧照片"]
}
```

**每 tick 评估**：
1. 计算动态概率 = base + idleBonus + emotionBonus + pressureBonus (上限 0.3)
2. 掷骰子，未通过则跳过
3. 随机选取一个 spark
4. 计算共鸣度 (resonance):
   - Embedding cosine similarity: spark 与 active events 的语义相似度 × intensity
   - 深夜加成: 22:00-05:00 +0.2
   - 积压加成: pressure > 0.3 时 +pressure×0.2
5. 共鸣度 ≥ threshold → 注入 `inspiration:{keyword}` 事件

**Embedding 优化**：spark 关键词是静态的，embedding 只算一次并缓存。

### 新增类型
```typescript
// ImpulseConfig
sparkPool?: string[];              // 主题关键词
sparkProbability?: number;         // 基础概率 (默认 0.08)
sparkResonanceThreshold?: number;  // 共鸣阈值 (默认 0.4)
```

### Prompt 输出
灵感事件在 active_events 中显示为：
```xml
<active_events>
    灵感: 月亮 (强度0.6, 高度相关, 0分钟前)
</active_events>
```

## ST 卡导入增强

导入 ST 角色卡时自动填充 V4 proactive 默认配置：
- impulse signals: idle(0.6) + emotion_pressure(0.3) + memory_breach(0.2)
- `extractSparkPool()`: 从卡片描述/性格文本提取 CJK 关键词 (去停用词, 取前 8 个)
- memoryBreachThreshold: 0.7, sparkProbability: 0.08, sparkResonanceThreshold: 0.4

## 测试

### 单元测试 (21 个)
| Feature | Tests | 覆盖 |
|---------|-------|------|
| F1: 认知过滤 | 5 | 放大/截断/衰减/默认值/无配置 |
| F2: 蓄水池 | 7 | 初始化/积累/衰减/截断/breach 激活/未达阈值/prompt |
| F3: 自我反馈 | 4 | fire 后 awaiting/正面反馈/忽略反馈/初始化 |
| F4: 灵感 | 5 | 无 pool/概率触发/共鸣门控/灵感标签/向后兼容 |

### 分布式测试 (7 个场景)
`tests/distributed/proactive-v4-behavioral.py` — V2 vs V4 prompt 对比：
1. pressure_breach — 蓄水池决堤
2. spark_loneliness — 深夜灵感
3. spark_nostalgia — 怀旧共鸣
4. positive_feedback — 正面反馈
5. ignored_message — 被忽略
6. sensitive_conflict — 认知放大
7. combined_v4 — 全特性联合

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/types.ts` | +12 行 (4 个类型扩展) |
| `src/engines/proactive/index.ts` | +140 行 (4 个 feature 实现) |
| `src/importers/st-card.ts` | +54 行 (V4 默认配置 + sparkPool 提取) |
| `tests/proactive.test.ts` | +409 行 (21 个 V4 测试) |
| `tests/distributed/proactive-v4-behavioral.py` | 631 行 (新文件) |
