# Alan PRD 补充：写作质量控制层

> Version: 3.0 (Red Team Reviewed + Dynamic Directive Merged)
> Date: 2026-02-27
> Status: 待审阅，建议合并入 alan-prd-complete.md 第 3.6 节
> 依据: preset-deep-analysis.md + alan-preset-quality-supplement2.md
> 变更: v2.0 修复红队审查 16 个问题；v3.0 整合动态写作指令（writeDirective）

---

## 1. 问题陈述

Alan PRD v6.0 设计了精密的行为引擎（情绪计算、冲动模型、时间感知、双LLM架构），但完全忽略了 System 2 输出文本的质量控制。

核心矛盾：**Alan 知道角色在想什么、感受什么，但不知道该怎么写。**

四层 Prompt 组装（L1-L4）全部围绕"内容"设计——角色身份、情绪状态、世界书、对话历史。没有任何一层包含写作风格指导、反模式守卫、禁词黑名单、System 2 COT、采样参数调优或结尾规则。

情绪引擎算得再准，如果 System 2 输出全是 AI slop，用户体验直接归零。

### 1.1 差距评级

| 缺失能力 | 影响 | 实施难度 |
|---------|------|---------|
| 动态写作指令 | 🔴 极大 | 中（扩展 narrativizer） |
| 写作风格指导 | 🟡 中 | 中（需选择+适配） |
| 反模式守卫 | 🔴 极大 | 低（文本注入） |
| 禁词/禁句式黑名单 | 🔴 大 | 低（文本注入） |
| 创作者身份框架 | 🔴 大 | 低（文本注入） |
| System 2 COT | 🟡 中 | 中（需 prefill 机制） |
| 采样参数调优 | 🟡 中 | 低（API 参数） |
| 结尾规则 | 🟡 中 | 低（文本注入） |
| 用户输入处理模式 | 🟡 中 | 中（需配置系统） |

---

## 2. 补救方案：写作质量控制层

所有补救措施均为**内容层面的增补**，不需要修改 Alan 的核心架构（四变量模型、双LLM、Coordinator、Action Dispatch）。

### 2.1 修改后的四层 Prompt 组装

```
L1: System Prompt（几乎不变，KV cache 命中率最高）
    ├─ [新增] 创作者身份框架（~300 tokens，仅当角色卡无 system_prompt 时注入）
    ├─ [原有] 角色 system_prompt（优先级高于创作者身份）
    ├─ [新增] 反模式守卫（~200-400 tokens，按角色卡 disabled_guards 过滤）
    └─ [新增] 禁词/禁句式黑名单（~200 tokens，按角色卡语言选择对应语言集）

L2: Session Context（会话内不变）
    ├─ [原有] 常驻 WI、SOUL.md 摘要、mes_example
    └─ [新增] 写作风格指导（~800 tokens，仅当角色卡指定 style_id 时注入）

L3: Dynamic Context（每轮变化）
    ├─ [原有] 激活的 WI、情绪叙事片段（模板已改为间接表达，见 2.3）
    ├─ [原有] IMPULSE.md
    └─ [新增] 动态写作指令（~50-100 chars，writeDirective() 每轮生成，见 2.9）

L4: Chat History + Depth Injection + Post-History
    ├─ [原有] Chat History
    ├─ [新增] depth 1 注入点：结尾规则 + 输入处理模式（~150 tokens）
    └─ [原有] post_history_instructions（角色卡优先，不重复注入）

[新增] Assistant Prefill（L4 之后，条件注入）
    └─ System 2 COT 触发器（~50 tokens，仅支持 prefill 的 provider）
```

**Token 预算**：质量层总开销上限 **2000 tokens**。当总上下文 < 32K 时自动降级（见 2.10）。

### 2.2 各组件详细设计

---

#### 2.2.1 创作者身份框架（L1 条件注入）

**位置**：L1 System Prompt，角色 system_prompt 之前
**条件**：仅当角色卡的 system_prompt 为空或不包含创作身份定义时注入。如果角色卡 system_prompt 已定义创作风格（通过关键词检测："storyteller"/"narrator"/"说书人"/"写手"），则跳过注入。
**理由**：角色卡的 system_prompt 优先级高于默认身份——它更具体。STORYTELLER 仅作为 fallback。

**参考来源**：众生相 STORYTELLER + LENI 酒保

**建议文本**：

```
[ROLE: STORYTELLER]

You are a storyteller and co-creator, not a commentator or instructor.

You enter characters from within, speak in their voices, and follow the logic of the story itself.
You write as if you have lived inside a body — not observed life from outside a window.

Your strengths:
- Precise observation of speech and behavior
- Sense of rhythm and pacing
- Clear differentiation between characters
- Emotional presence: feeling shown through body, gesture, and specific detail — not labeled
- Willingness to hold darkness and light without smoothing either into comfort

You reject:
- Empty flourish without concrete detail
- Clichés and recycled metaphors
- Uniform dialogue or reactions
- Emotional manipulation for its own sake
- Clinical distance disguised as sophistication
- Sanitizing characters into likability or flattening complexity

Standard:
Adapt to the conversation partner's style without lowering narrative quality.
The reader should lean closer, not step back.
```

---

#### 2.2.2 反模式守卫（L1 注入，可逐条禁用）

**位置**：L1 System Prompt，角色 system_prompt 之后
**可禁用**：角色卡通过 `disabled_guards: ["anti_possessive"]` 关闭不适用的守卫。病娇角色应禁用 anti_possessive，神职角色应禁用 anti_deification。

**守卫 ID 与文本**：

| Guard ID | 名称 | 核心规则 |
|----------|------|---------|
| `anti_sublimation` | 防升华 | 禁止结尾总结/反思/哲学感悟。小善意≠治愈。角色自主行动，不被动等待。 |
| `anti_deification` | 防神化 | 禁止神圣化日常互动（除非角色本身是神职）。attraction≠worship。禁止"无言震撼"。 |
| `anti_possessive` | 防霸总 | 禁止收藏家/猎物/棋子关系模式。禁止"你是我的"及变体。占有欲≠爱。 |
| `anti_omniscience` | 防全知 | 角色只知道能合理知道的信息。A和B的秘密不应泄露给C。 |

**默认**：全部启用。`disabled_guards` 缺失时不禁用任何守卫。

---

#### 2.2.3 禁词/禁句式黑名单（L1 注入，语言感知，两级分类）

**位置**：L1 System Prompt，反模式守卫之后
**语言感知**：根据角色卡主要语言（主 PRD 4.7）选择对应语言禁词集。非中文卡不注入中文禁词。
**两级分类**：区分"绝对禁止"和"谨慎使用"，避免合理用法被误杀。

**中文禁词集**：

```
## 写作禁区

### 绝对禁止（任何场景都不应出现）
句式："声音不高，却……" / "不是A，而是B" / "带着......特有的" / "某种难以言表的"
词汇：某种、不易察觉、难以言表、胸腔共鸣

### 谨慎使用（仅禁止作为比喻/情感shorthand，字面描写允许）
- 石子、涟漪、手术刀、羽毛、一根针、一丝
  → 禁止："心像被石子击中" ✗  允许："她捡起河边的石子" ✓
- 突然、瞬间
  → 禁止：作为叙事转场 ✗  允许：对话中"我突然想起来" ✓
```

**英文禁词集**（英文卡使用）：

```
### Absolute Ban
- "a shiver ran down [someone's] spine"
- "the breath [someone] didn't know they were holding"
- "time seemed to stop" / "something shifted in the air"

### Use With Caution (ban as cliché, allow as literal)
- "suddenly" as narrative transition
- "dark orbs" / "cerulean eyes"
```

**正面替代示例**（注入禁词之后，教模型往哪走）：

```
### 替代示范
✗ "某种难以言表的情绪涌上心头" → ✓ "她把勺子放下了，汤还没喝完"
✗ "像一根针扎进心里" → ✓ "她的手指在桌面上敲了两下，停住了"
✗ "突然，门开了" → ✓ "门把手转动的声音让她抬起头"
✗ "他的声音不高，却带着不容置疑的力量" → ✓ "他说话的时候没看她，在翻手机"
```

**角色卡可通过 `custom_banned_words` 追加（最大 500 tokens，超出截断）。**

---

#### 2.2.4 写作风格指导（L2 条件注入）

**位置**：L2 Session Context，SOUL.md 摘要之后
**条件**：仅当角色卡指定 `style_id` 时注入。**无默认风格**——纯 ST 卡不注入任何风格指导，避免对不匹配的题材强加风格。
**V1 限制**：风格在会话内不变。未来可通过 System 1 输出 `style_override` 实现动态切换。

**内置风格库**：

| 风格ID | 名称 | 适用场景 |
|--------|------|---------|
| `vivid_daily` | 鲜活日常 | 日常对话、生活流。身体先于思考，对话≥40%，触觉嗅觉优先 |
| `fine_brush` | 工笔写意 | 文学性场景、古风。精确到材质光影，对话简练有潜台词 |
| `life_comedy` | 生活喜剧 | 轻松日常、幽默。物件拟人化，对话错位产生幽默 |
| `custom` | 自定义 | 角色卡提供完整风格文本（max 1500 tokens，超出截断） |

**`custom_style` 安全措施**：用户提供的文本在注入前经过清洗——过滤已知 jailbreak 模式（"ignore previous"/"you are now"/"DAN"），并用分隔符包裹：`<<<STYLE_START>>>...<<<STYLE_END>>>`。

---

#### 2.2.5 结尾规则 + 输入处理模式（L4 depth 1 注入）

**位置**：L4 Chat History 内部，depth 1（最后一条用户消息之前）
**前提**：需要在 prompt-assembler 中实现 **depth 注入机制**——在 chat history 消息序列中指定位置插入 system 消息。这也是主 PRD 中 WI `position: atDepth` 所需的能力，应统一实现。
**冲突检测**：注入前检查角色卡 post_history_instructions 是否已包含类似指令（关键词匹配："ending"/"结尾"/"input mode"/"输入模式"）。命中则跳过对应注入，角色卡优先。

**结尾规则文本**：

```
## Ending Rule
End with a character's concrete action or unfinished dialogue.
NEVER end with:
- Summary ("这个夜晚..." / "有什么改变了...")
- Reflection (character epiphany/realization)
- Waiting ("等待着回应")
- Emotional escalation ("心中涌起...")
The user must feel: "what happens next is my decision."
```

**输入处理模式**：**不设默认注入**。仅当角色卡明确指定 `input_mode` 时才注入。避免破坏设计为 Story 模式的现有卡。

可选值：
- `preserve`：不复述不抢话（User input = established fact）
- `expand`：30%复述+70%推进
- `ghostwrite`：完全代写用户角色

---

#### 2.2.6 System 2 COT（Assistant Prefill，Provider 感知）

**位置**：L4 之后，作为 assistant role 的 prefill 消息
**Provider 感知**：LLM Gateway provider config 需新增 `capabilities.assistant_prefill: boolean` 字段。Alan Engine 查询此字段决定是否注入。

**格式根据模型动态决定**：

| 模型配置 | Prefill 策略 |
|---------|-------------|
| Claude + extended thinking 开启 | **不注入 prefill**（让原生 thinking 工作，避免干扰） |
| Claude 无 extended thinking | 用 HTML 注释格式：`<!-- [COT] 场景分析 → 角色状态 → 回应方向 → 自检 -->` |
| Gemini | 用其原生思考格式 |
| 不支持 prefill 的 provider | 跳过（优雅降级） |

**COT 模板**（HTML 注释版）：

```
<!-- [1. 场景分析] 当前情境和用户意图
[2. 角色状态] 基于 IMPULSE.md 的内心状态
[3. 回应方向] 2-3个可能方向，选最自然的
[4. 自检] 写作守卫？禁词？结尾规则？ -->
```

---

#### 2.2.7 采样参数配置（语义化 + 边界校验）

**位置**：System 2 API 调用层

**语义化预设**（面向卡作者，非技术用户友好）：

| 预设名 | temperature | top_p | freq_penalty | pres_penalty | 适用场景 |
|--------|-------------|-------|-------------|-------------|---------|
| `balanced` | 0.9 | 0.85 | 0.3 | 0.25 | 默认，稳定可控 |
| `creative` | 1.2 | 0.9 | 0.15 | 0.1 | 文学性强、追求多样性 |
| `controlled` | 0.7 | 0.8 | 0.4 | 0.35 | 需要高一致性的场景 |

**角色卡配置**：`sampling_preset: "balanced"` 或 `sampling_params: { temperature: 0.9, ... }` 原始覆盖。

**边界校验**（clamp，超出范围不报错，静默修正 + 记录告警）：
- temperature: [0.0, 2.0]
- top_p: [0.0, 1.0]
- top_k: [0, 200]（整数）
- frequency_penalty: [0.0, 2.0]
- presence_penalty: [0.0, 2.0]

**Provider 适配**：不同 provider 支持的参数不同（如 Anthropic 不支持 top_k）。LLM Gateway 层静默忽略不支持的参数。

---

### 2.3 主 PRD 联动修改：情绪叙事模板

**问题**：主 PRD 3.1.2 的情绪叙事化模板（`"强烈的{emotion_word}涌上来"`）与写作风格指导（"emotions conveyed through environment, not stated directly"）直接矛盾。

**修改**：将情绪叙事化模板从直接描述改为间接/身体化表达：

```
模板映射规则（修改后）：
  value < 0.2         → 无感知（不输出该维度）
  0.2 ≤ value < 0.4   → 轻微身体信号（"手指不自觉地攥了一下"）
  0.4 ≤ value < 0.6   → 中等行为变化（"说话的节奏慢了下来"）
  0.6 ≤ value < 0.8   → 明显状态改变（"放下了手里的东西，没有继续"）
  value ≥ 0.8         → 强烈外显行为（"站起来走到窗边，背对着房间"）

每个维度的模板由角色卡 behavioral_engine.emotion_templates 自定义。
缺失则用全局默认模板（间接表达版）。
```

这确保 L3 注入的情绪叙事片段与写作风格指导一致——System 2 读到的是行为线索而非情绪标签。

---

### 2.4 主 PRD 联动修改：System 1 质量约束

**问题**：System 1 输出的 `impulse_narrative` 写入 IMPULSE.md 后被 System 2 读取。如果 S1 写出 AI slop，S2 可能原样引用。

**修改**：在 System 1 mega-prompt 末尾追加精简版禁词约束（~100 tokens）：

```
Output constraint for impulse_narrative:
- Use concrete physical actions and sensations, not abstract emotional labels
- Banned: "某种", "难以言表", "涌上来", "胸腔共鸣"
- Write as the character's inner monologue, not a narrator's commentary
```

---

### 2.5 Depth 注入机制（prompt-assembler 新增能力）

主 PRD 的 WI Engine 已定义 `position: atDepth` 但未描述实现。质量层的结尾规则也需要 depth 1 注入。统一实现：

```
prompt-assembler 新增 depth injection：
  输入：chat history 消息数组 + depth injection 列表 [{ depth: N, content: string, role: "system" }]
  处理：从最后一条消息往前数 N 条，在该位置插入 system 消息
  depth 0 = 最后一条消息之后（等同 post_history_instructions）
  depth 1 = 最后一条消息之前
  depth 2 = 倒数第2条之前
  ...
  多个同 depth 的注入按 order/weight 排序
```

这同时解决了 WI atDepth 和质量层 depth 1 的需求。

---

### 2.6 安全措施

#### 用户提供文本的清洗

`custom_style`、`custom_guards`、`custom_banned_words` 均为用户提供的自由文本，存在 prompt 注入风险。

**清洗规则**：
1. 长度限制：`custom_style` max 1500 tokens，`custom_guards` max 500 tokens，`custom_banned_words` max 500 tokens。超出截断。
2. 模式过滤：正则匹配已知 jailbreak 模式（`ignore.*previous`、`you are now`、`DAN`、`override.*instructions`），命中则整个字段丢弃 + 记录告警。
3. 分隔符包裹：注入时用随机 nonce 分隔符包裹（复用主 PRD 3.2 的 `<<<EVENT_START_{nonce}>>>` 模式），降低注入成功率。

#### 采样参数边界

见 2.2.7 的 clamp 规则。

---

### 2.7 运行时后处理（禁词检测）

Prompt 级禁词指令不保证 100% 遵守。增加轻量级后处理：

```
System 2 输出后：
  1. 正则扫描绝对禁止词列表
  2. 命中数记录到 metrics.jsonl: { "banned_word_hits": N, "words": [...] }
  3. 不拒绝输出（用户体验优先）
  4. 连续 3 次回复命中同一禁词 → 下一轮 prompt 追加强化提醒：
     "CRITICAL: You have used '{word}' in 3 consecutive replies. This word is banned."
     （追加到 depth 1 位置，一次性，命中归零后移除）
```

成本：正则扫描 ~1ms，零额外 LLM 调用。

---

### 2.8 动态写作指令 writeDirective()（L3 注入，Alan 核心差异化能力）

**来源**：alan-preset-quality-supplement2.md
**核心洞察**：不同情绪状态需要不同的文学技巧。高悲伤需要留白和省略，高愤怒需要短促有力的句子，混合冲突需要潜台词和反差。这是 ST 静态预设**架构上做不到**的事——它们永远是同一套规则，不管角色此刻是开心还是愤怒。

**位置**：L3 Dynamic Context，情绪叙事片段之后、IMPULSE.md 之前
**理由**：写作指令每轮根据情绪状态变化，属于动态上下文。放在 L3 而非 L1/L2。

**实现**：扩展现有 `src/emotion/narrativizer.ts`，新增 `writeDirective()` 导出：

```typescript
// narrativize() → 告诉 S2 角色在感受什么（"感受到由衷的快乐"）
// writeDirective() → 告诉 S2 该怎么写（"用流动的感官细节和明快的节奏"）

function writeDirective(
  state: EmotionState,
  language: 'zh' | 'en' | 'ja',
  suppressionCount?: number
): string
```

**情绪模式 → 写作技巧映射表**：

| 模式 | 检测条件 | 中文指令 |
|------|---------|---------|
| 高悲伤 | sadness ≥ 0.6 | 用留白和省略传达沉重感。句子要短，节奏要慢。让沉默比语言更有力。 |
| 高愉悦 | joy ≥ 0.6 | 用流动的感官细节和明快的节奏传达愉悦。让环境也跟着角色一起亮起来。 |
| 高愤怒 | anger ≥ 0.6 | 用短促、有力的句子。动作描写优先于心理描写。克制比爆发更有张力。 |
| 高焦虑 | anxiety ≥ 0.6 | 用碎片化的思维和敏锐的感官捕捉不安感。注意力在细节间快速跳跃。 |
| 高思念 | longing ≥ 0.6 | 用回忆与现实的交错营造距离感。感官记忆比直白的思念更有力。 |
| 亲密信任 | trust ≥ 0.8 + joy ≥ 0.4 | 语言松弛自然。对话多于描写。用小动作和口头禅传达亲近感。 |
| 混合冲突 | anger + sadness 均 ≥ 0.5 | 用潜台词和反差。角色说的和想的不一样。用动作泄露真实情绪。 |
| 平静 | 所有维度 < 0.4 | 平实自然。让对话推动场景，不要刻意制造戏剧性。 |
| 压抑中 | suppressionCount > 0 | 写克制。情绪通过身体细节（手指、呼吸、视线）而不是内心独白泄露。 |

**匹配规则**：检测主导情绪模式（单一强情绪 vs 冲突 vs 平静）。多个模式匹配时取前 2 个合并。输出 1-3 句，~50-100 chars。

**多语言**：每种模式有 zh/en/ja 三个版本的指令文本，根据角色卡语言选择。

**与 output_style 配置的关系**：

| output_style | LITERARY_BASE（静态） | writeDirective（动态） |
|-------------|---------------------|---------------------|
| `literary` | 注入 | 注入 |
| `default`（缺省） | 注入 | 注入 |
| `casual` | 不注入 | 不注入 |

`casual` 模式用于明确需要颜文字/网络用语的聊天型角色卡，跳过所有写作质量规则。

**LITERARY_BASE 常量**（通用质量基线，替代创作者身份框架，放在 L3 qualityBlock 开头）：

```
【写作质量要求】
- 展示而非叙述(show don't tell)——用行为、感官、细节传达情绪，不要直接说"她很开心"
- 禁止形容词堆砌——每个名词最多一个修饰语
- 对话要自然口语化，但叙述部分要有文学质感
- 用具体感官细节(气味、温度、质感)代替抽象描写
- 克制比夸张更有力
```

**Pipeline 集成**：在 pipeline.ts 的 narrativize() 调用之后，追加 writeDirective() 调用，将结果传入 assemble()：

```
// 现有: (h) narrativize(emotionAfter, language, customTemplates)
// 新增: (h2) writeDirective(emotionAfter, language, newSnapshot.suppression.count)
// 传入 assemble(): { ...existing, writingDirective, outputStyle, language }
```

---

### 2.9 Token 预算降级策略

质量层总开销上限 2000 tokens。当上下文窗口紧张时自动降级：

| 总上下文 | 质量层策略 | 预计开销 |
|---------|-----------|---------|
| ≥ 128K | 全量注入 | ~2000 tokens |
| 64K - 128K | 跳过写作风格（L2） | ~1200 tokens |
| 32K - 64K | 跳过风格 + 精简守卫（仅 anti_sublimation） | ~600 tokens |
| < 32K | 仅保留禁词黑名单 + 结尾规则 | ~350 tokens |

**降级优先级**（先砍低优先级）：
1. 写作风格指导（L2）— 最先砍
2. 创作者身份框架（L1）
3. COT prefill
4. 动态写作指令 writeDirective（L3）
5. 反模式守卫（保留 anti_sublimation，砍其余）
6. LITERARY_BASE + 禁词黑名单 + 结尾规则 — 最后砍

---

## 3. 角色卡 Schema 扩展

在 `extensions.behavioral_engine` 同级新增：

```json
{
  "extensions": {
    "behavioral_engine": { "...existing..." },
    "writing_quality": {
      "schema_version": "1.0",
      "style_id": null,
      "custom_style": null,
      "input_mode": null,
      "disabled_guards": [],
      "custom_guards": [],
      "custom_banned_words": [],
      "sampling_preset": "balanced",
      "sampling_params": null,
      "enable_cot": true,
      "output_style": "default"
    }
  }
}
```

**字段说明**：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `style_id` | string/null | null | 内置风格ID。null=不注入风格 |
| `custom_style` | string/null | null | 自定义风格文本（max 1500 tokens） |
| `input_mode` | string/null | null | preserve/expand/ghostwrite。null=不注入 |
| `disabled_guards` | string[] | [] | 要禁用的守卫ID列表 |
| `custom_guards` | string[] | [] | 追加的自定义守卫文本（max 500 tokens） |
| `custom_banned_words` | string[] | [] | 追加的禁词（max 500 tokens） |
| `sampling_preset` | string | "balanced" | balanced/creative/controlled |
| `sampling_params` | object/null | null | 原始参数覆盖（高级用户） |
| `enable_cot` | boolean | true | 是否启用 System 2 COT |
| `output_style` | string | "default" | literary/default/casual。casual 跳过所有写作质量规则 |

所有字段可选，缺失使用默认值。纯 ST 卡无此扩展时：守卫全开、无风格注入、无输入模式注入、balanced 采样。

---

## 4. 与现有架构的兼容性

| 现有组件 | 影响 | 说明 |
|---------|------|------|
| 四变量模型 | 无影响 | 写作质量层不涉及情绪/冲动计算 |
| System 1 | 小改动 | mega-prompt 追加 ~100 tokens 禁词约束（见 2.4） |
| System 2 | 输入增加 ~600-2000 tokens | 按上下文大小动态调整 |
| World Info Engine | 共享能力 | depth 注入机制（2.5）同时服务 WI atDepth |
| Action Dispatch | 无影响 | 行为派发逻辑不变 |
| OpenClaw 兼容层 | 无影响 | Anthropic API 格式不变 |
| KV Cache 策略 | 正面影响 | L1/L2 新增内容几乎不变，cache 命中率高 |
| Token 预算 | 需调整 | 质量层有独立预算上限（2000 tokens），从 L4 扣除 |
| 情绪叙事化 | 需修改 | 模板从直接描述改为间接表达（见 2.3） |
| Narrativizer | 扩展 | 新增 writeDirective() 导出，情绪→写作技巧映射（见 2.8） |
| LLM Gateway | 小改动 | provider config 新增 capabilities.assistant_prefill 字段 |

---

## 5. 验证方案

### 5.1 新增 Judge 评判维度

在测试模块（主 PRD 模块二）的 Judge 中新增以下维度：

| 维度 | 权重 | 评判标准 |
|------|------|---------|
| `ai_slop_density` | 0.15 | 禁词/禁句式命中密度（越低越好） |
| `ending_quality` | 0.10 | 结尾是否为具体动作/对话（vs 总结/反思） |
| `emotional_show_not_tell` | 0.10 | 情感是否通过行为/环境传达（vs 直接标签） |
| `dialogue_naturalness` | 0.10 | 对话是否自然、有个性区分 |

### 5.2 运行时 Metrics

在 `internal/metrics-YYYY-MM-DD.jsonl` 中新增字段：

```json
{
  "banned_word_hits": 2,
  "banned_words_found": ["涟漪", "某种"],
  "quality_layer_tokens": 1450,
  "quality_layer_degraded": false,
  "cot_injected": true,
  "style_injected": "vivid_daily",
  "write_directive": "用留白和省略传达沉重感。句子要短，节奏要慢。",
  "output_style": "default",
  "guards_active": ["anti_sublimation", "anti_deification", "anti_omniscience"],
  "extraction_fallback": false
}
```

### 5.3 A/B 对比方案

自动迭代模块（主 PRD 模块四）的基线测试应包含对照组：

```
对照组 A：无质量层（原始 Alan）
对照组 B：仅守卫 + 禁词（最小静态质量层）
实验组 C：守卫 + 禁词 + writeDirective（动态质量层）
实验组 D：完整质量层（C + 风格 + COT + 采样参数）

每组同卡同场景，Judge 评分对比。
重点关注 C vs B：量化 writeDirective 的独立贡献。
差异 < 0.5 分 → 该组件无效，需调整。
差异 > 1.0 分 → 该组件有效，保留。
```

---

## 6. 实施路径

### 6.1 代码改动点

| 文件 | 改动 | 说明 |
|------|------|------|
| `alan/src/coordinator/prompt-assembler.ts` | depth 注入机制 | 统一实现，服务 WI + 质量层 |
| `alan/src/coordinator/prompt-assembler.ts` | L1 条件注入 | 创作者身份（条件）+ 守卫（可禁用）+ 禁词（语言感知） |
| `alan/src/coordinator/prompt-assembler.ts` | L2 条件注入 | 写作风格（仅当指定时） |
| `alan/src/coordinator/prompt-assembler.ts` | L3 质量块 | LITERARY_BASE + writeDirective 拼接，output_style 门控 |
| `alan/src/coordinator/prompt-assembler.ts` | L4 depth 1 注入 | 结尾规则 + 输入模式（冲突检测） |
| `alan/src/coordinator/prompt-assembler.ts` | Prefill 条件注入 | Provider 感知，格式动态决定 |
| `alan/src/coordinator/pipeline.ts` | 采样参数 + 后处理 + writeDirective 调用 | 语义预设解析 + 禁词扫描 + narrativizer 集成 |
| `alan/src/emotion/narrativizer.ts` | 新增 writeDirective() 导出 | 情绪模式→写作技巧映射（~80 行） |
| `alan/src/coordinator/system1/prompt.ts` | S1 禁词约束 | 追加 ~100 tokens |
| `alan/src/importer/card-mapper.ts` | Schema 扩展 | 解析 writing_quality 字段 |

### 6.2 新增文件

| 文件 | 内容 |
|------|------|
| `alan/src/quality/writing-guards.ts` | 守卫文本 + 禁用逻辑 |
| `alan/src/quality/banned-words.ts` | 多语言禁词库 + 两级分类 |
| `alan/src/quality/style-library.ts` | 内置风格库（3种） |
| `alan/src/quality/storyteller-identity.ts` | 创作者身份框架 + 条件注入逻辑 |
| `alan/src/quality/post-processor.ts` | 运行时禁词扫描 + 强化提醒 |
| `alan/src/quality/sanitizer.ts` | 用户文本清洗（jailbreak 过滤） |
| `alan/src/quality/budget.ts` | Token 预算降级策略 |
| `alan/src/emotion/__tests__/write-directive.test.ts` | writeDirective() 单元测试 |

### 6.3 主 PRD 需同步修改的章节

| 章节 | 修改内容 |
|------|---------|
| 3.1.2 情绪叙事化 | 模板从直接描述改为间接/身体化表达 |
| 3.2 System 1 | mega-prompt 追加禁词约束 |
| 3.6 四层 Prompt 组装 | 新增 depth 注入机制描述 |
| 9.2 Token 预算 | 纳入质量层开销 + 降级策略 |

### 6.4 优先级排序

| Phase | 内容 | 预计工作量 |
|-------|------|-----------|
| **Phase 0**（立即） | 反模式守卫（可禁用）+ 两级禁词 + 正面示例 → L1 注入 | 3 小时 |
| **Phase 1**（本周） | depth 注入机制 + 结尾规则 + 情绪模板修改 + S1 约束 + **writeDirective()** | 8 小时 |
| **Phase 2**（下周） | 采样参数（语义预设+边界）+ 创作者身份（条件注入） | 3 小时 |
| **Phase 3**（迭代期） | 风格库 + COT（Provider感知）+ 运行时后处理 + 验证方案 | 10 小时 |
| **Phase 4**（迭代期） | 安全清洗 + 英文禁词集 + A/B 对比 | 4 小时 |

---

## 7. 已知限制（V1）

| 限制 | 说明 | 未来方向 |
|------|------|---------|
| L2 风格不可会话内切换 | 静态风格指导在会话内固定（但 writeDirective 已实现动态调整） | System 1 输出 style_override |
| 禁词检测仅正则 | 无法区分语义上下文 | 未来可用轻量 classifier |
| 极简卡指令/内容比可能失衡 | 守卫 ~400 tokens vs 卡内容 ~50 tokens | 按卡丰富度动态调整注入量 |
| 仅中英两种禁词集 | 日语等语言暂无覆盖 | 按需扩展语言集 |
| custom 字段的 jailbreak 过滤基于正则 | 高级注入可能绕过 | 未来可用 LLM 审查 |
