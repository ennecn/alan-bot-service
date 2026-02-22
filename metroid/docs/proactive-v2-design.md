# Proactive Engine V2 — 行为模型设计

> 日期: 2026-02-22
> 状态: ✅ 已实现, 114 tests 全通过
> 前置: proactive.test.ts 84 tests 全通过，零 bug

## 1. 核心理念

人类行为可以抽象为：**行为 = trigger(冲动)**，其中冲动由情绪、事件、时间三个变量驱动。

模型的角色是**导演**，LLM 是**演员**：
- 模型负责计算"此刻的内心状态是什么"（毫秒级）
- LLM 负责把内心状态变成自然语言行为（API 调用）
- 模型的输出 = 注入 LLM prompt 的结构化舞台指令

## 2. 数学模型

### 状态变量

```
E(t) ∈ ℝ³     — 情绪状态 (PAD: pleasure, arousal, dominance)
L(t) ∈ ℝᵏ     — 长期情绪 (attachment, trust, ... 跨会话持久化)
V(t) = {vᵢ}   — 活跃事件集合 (每个事件有 intensity, relevance, decay)
I(t) ∈ [0,1]   — 冲动值 (行为压力累积器)
```

### 动力学方程

**情绪演化:**
```
dE/dt = Recovery(E, baseline, personality)
      + Σᵢ EventImpact(vᵢ) × relevance(vᵢ)

Recovery 模式 (personality 参数):
  natural:      γ × (baseline - E)           — 自然恢复到基线
  event-driven: 只在特定事件发生时恢复          — 需要"做事"才能好起来
  mixed:        γ_slow × (baseline - E) + events — 两者兼有
```

**长期情绪演化:**
```
L_new = α × sessionAverage(E) + (1 - α) × L_old

α = 1 - moodInertia (personality 参数)
  善变角色: α = 0.3 (最近会话影响大)
  稳定角色: α = 0.05 (需要很多次会话才能改变)
```

**事件演化:**
```
exponential:  intensity × exp(-decayRate × hours)
deadline:     intensity × urgency(t, deadline)    — 未来扩展
persistent:   不衰减，直到显式移除                    — 未来扩展
```

**冲动累积:**
```
dI/dt = Σⱼ wⱼ × σⱼ(E, V, t) - decay × (1 + restraint)

σⱼ = signal activation:
  idle:             smoothstep(idleMinutes / targetMinutes)
  emotion_pattern:  allConditionsMet ? 1 : 0  (gated by eventGate)
  time_of_day:      inRange ? 1 : 0
  emotion_pressure: ‖E - baseline‖ × direction  — 新增信号类型
```

**行为触发:**
```
θ_dynamic = θ_base + restraint × 0.3 - suppressionBonus
p_fire = sigmoid(k × expressiveness × (I - θ_dynamic))
if random() < p_fire → FIRE
  I = 0.2 (residual)
  suppressionCount = 0
else → SUPPRESS
  suppressionCount++
```

## 3. 模型输出 → LLM Prompt

触发时，模型计算并格式化以下信息注入 prompt：

```xml
<internal_state>
  <emotion_trajectory>
    pleasure: -0.20 (持续下降中，过去2小时从0.3降至-0.2)
    arousal: 0.10 (平稳)
    dominance: -0.05 (略微被动)
  </emotion_trajectory>

  <long_term_mood>
    对用户的依恋: 0.7 (逐渐增强)
    信任感: 0.5 (稳定)
  </long_term_mood>

  <active_events>
    离别 (强度0.8, 高度相关, 2小时前)
    考试 (强度0.3, 间接相关, 5小时前)
  </active_events>

  <trigger_context>
    冲动强度: 72%
    已抑制: 3次 (一直想说但没说)
    主要驱动: 离别事件 + 长时间沉默
    沉默时长: 45分钟
  </trigger_context>
</internal_state>
```

## 4. 与现有引擎的差距 & 改动清单

### 4.1 evaluateAll 快照一致性 (P0)

**现状**: `recordEmotionSnapshot()` 只在 start() 和 setInterval 中调用
**改动**: 在 `evaluateAll()` 开头调用 `recordEmotionSnapshot()`
**影响**: ~1 行代码

### 4.2 情绪轨迹计算 (新增)

**现状**: ring buffer 存了快照但只用于 delta/sustained 触发器
**改动**: 新增 `computeTrajectory(agentId, windowMs)` 方法
**输出**: `{ direction: 'rising'|'falling'|'stable', delta, durationMinutes }`
**影响**: ~20 行代码

### 4.3 长期情绪 (新增)

**现状**: 无跨会话情绪记忆
**改动**:
  - DB 新增 `long_term_mood` 表 (agent_id, dimension, value, updated_at)
  - 新增 `updateLongTermMood(agentId)` — 会话结束时调用
  - 新增 `getLongTermMood(agentId)` — prompt 构建时调用
  - Card 扩展: `emotion.moodInertia`, `emotion.longTermDimensions`
**影响**: ~60 行代码 + schema 变更

### 4.4 事件 relevance (新增)

**现状**: 所有事件等权，无相关性概念
**改动**:
  - `ActiveEvent` 类型新增 `relevance: number` 字段
  - `EVENT_PATTERNS` 每个模式加默认 relevance
  - `addActiveEvent()` 接受 relevance 参数
  - emotion_pattern 信号的 eventGate 改为 `max(intensity × relevance)`
**影响**: ~15 行代码

### 4.5 eventGate 放松 (改进)

**现状**: emotion_pattern 无事件时 eventGate=0，完全阻断
**改动**: 新增 `emotion_pressure` 信号类型，不受 eventGate 门控
  - activation = ‖E - baseline‖ (情绪偏离基线的程度)
  - 允许纯情绪驱动的 impulse，但权重较低
**影响**: ~15 行代码

### 4.6 fireImpulse prompt 重构 (改进)

**现状**: prompt 只包含 P/A/D 数值、事件名、冲动强度
**改动**: 构建结构化 `<internal_state>` XML，包含:
  - 情绪轨迹 (方向 + 持续时间)
  - 长期情绪
  - 事件 + relevance
  - 抑制历史 (自然语言描述)
  - 沉默时长
**影响**: ~40 行代码

### 4.7 impulse triggerType 细化 (改进)

**现状**: 固定 triggerType='emotion', triggerId='impulse'
**改动**: 基于触发时贡献最大的信号决定 triggerType
  - `impulse:idle` / `impulse:emotion` / `impulse:event` / `impulse:mixed`
**影响**: ~10 行代码

### 4.8 对话事件冷却 (改进)

**现状**: 同名事件 deduplicate 取 max intensity，但无时间冷却
**改动**: 同名事件在 N 分钟内不重复注入 (或降低 intensity)
**影响**: ~10 行代码

### 4.9 Card emotion 配置扩展

```ts
emotion: {
  baseline: { pleasure: 0, arousal: 0, dominance: 0 },
  intensityDial: 0.8,
  expressiveness: 0.8,
  restraint: 0.2,
  // V2 新增
  recoveryMode: 'natural',        // 'natural' | 'event-driven' | 'mixed'
  recoveryRate: 0.05,             // natural 恢复速率
  moodInertia: 0.9,              // 长期情绪惯性 (0-1, 越高越稳定)
  longTermDimensions: ['attachment', 'trust'],  // 跟踪的长期情绪维度
}
```

## 5. 计算性能预算

```
每次 check interval (60s):
  recordEmotionSnapshot()       O(1)      ~1μs
  decayActiveEvents()           O(m)      ~10μs  (m ≤ 10)
  computeSignalActivations()    O(s)      ~5μs   (s ≤ 5)
  updateImpulse()               O(1)      ~1μs
  checkFiring()                 O(1)      ~1μs
  ─────────────────────────────────────────
  总计                                     ~20μs

触发时 (偶发):
  computeTrajectory()           O(60)     ~50μs
  getLongTermMood()             O(1)      ~10μs  (DB read)
  formatInternalState()         O(1)      ~5μs
  callLLM()                     ─         ~2-5s  (唯一重操作)
  ─────────────────────────────────────────
  总计 (不含 LLM)                          ~65μs

每次会话结束 (偶发):
  updateLongTermMood()          O(1)      ~100μs (DB write)
```

所有数学计算加起来不超过 0.1ms，完全在计算机能力范围内。

## 6. 测试策略

每个改动对应新增测试:
- 4.1: 验证 evaluateAll 录入快照
- 4.2: 轨迹计算 rising/falling/stable
- 4.3: 长期情绪 EMA 更新 + DB 持久化
- 4.4: relevance 影响 eventGate
- 4.5: emotion_pressure 信号无事件也能累积
- 4.6: prompt 包含所有新字段
- 4.7: triggerType 反映 dominant signal
- 4.8: 事件冷却去重

## 7. 未来扩展 (不在本次实现)

- deadline 事件类型 (等100天)
- persistent 事件类型 (不衰减)
- 情绪恢复的 event-driven 模式
- 多维长期情绪的交叉影响
- 基于 LLM 的事件 relevance 评估
