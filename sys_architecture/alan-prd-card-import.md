# Alan PRD — 角色卡 & 世界书导入转换模块

> Date: 2026-02-26
> Status: 设计讨论完成，待实现

---

## 1. 设计原则

- **统一管线，零模式切换**：所有卡走同一条处理管线，卡的丰富度决定输出的丰富度
- **渐进增强**：纯 ST 卡导入后天然拥有基础情绪感知和语义匹配，无需卡作者额外工作
- **不追求 ST 完全一致**：目标是在新引擎上的效果，不是复刻 ST 的输出
- **重写而非复用**：老 Metroid 代码不复用，st-assembler 算法逻辑仅作参考

## 2. 老 Metroid 失败教训

| 问题 | 后果 |
|------|------|
| World Info 导入了但运行时从未激活 | lorebook 内容对 LLM 不可见 |
| system_prompt / post_history_instructions 丢弃 | 卡的核心行为定义丢失 |
| prompt 格式不匹配（缺少 ST 标记） | LLM 看到不同结构 |
| 无 ST preset 支持 | token budget / AN depth 全忽略 |
| 先兼容 ST 再打补丁 → 架构腐化 | 系统毫无鲁棒性 |

## 3. 解析层（Parse）

支持两种载体：
- PNG 文件（JSON 嵌入 tEXt chunk）
- 纯 JSON 文件

提取三类数据：
- 角色定义：name, description, personality, scenario, first_mes, mes_example, alternate_greetings
- 指令层：system_prompt, post_history_instructions
- 世界书：character_book.entries[]（每条 30+ 字段）

## 4. 映射层（Map）

```
ST Card V2                              Alan 内部结构
─────────────                           ──────────────
name, description, personality      →   IDENTITY.md（角色是谁）
scenario                            →   IDENTITY.md（场景上下文）
system_prompt                       →   L1 System Prompt（最稳定层，享受 KV cache）
post_history_instructions           →   L4 Post-History Injection
first_mes + alternate_greetings     →   Greeting Pool（首条消息随机选择）
mes_example                         →   Example Dialogue（保留 <START> 格式）
character_book.entries[]            →   World Info Engine 条目库（保留所有 30+ 字段）
extensions.behavioral_engine        →   行为引擎参数（缺失则用默认值）
其他 extensions                     →   透传存储（未来可扩展）
```

### 文件职责划分

| 文件 | 职责 | 示例（病娇角色） |
|------|------|------------------|
| IDENTITY.md | 我是谁（性格、外貌、背景） | "表面温柔体贴，内心占有欲极强" |
| SOUL.md | 我的底线（不可动摇的价值观） | "永远不会真正伤害他"、"不会放手" |
| behavioral_engine 参数 | 性格怎么运作（敏感度、阈值、衰减） | rejection_sensitivity: 2.5, fire_threshold: 0.3 |

## 5. 激活层（Activate）— World Info Engine

### 统一管线（替代 ST 的递归扫描）

```
任何卡 → 同一条管线：

  1. TextScanner 一次扫描（关键词/正则，不递归）
     - keys / secondary_keys / selective_logic
     - AND_ANY / AND_ALL / NOT_ANY / NOT_ALL
     - regex / whole_words / case_sensitive
     - probability / enabled / constant

  2. System 1 上下文扩展（替代 ST 递归扫描）
     - 输入：当前消息 + 已激活 entry + 所有未激活 entry 摘要
     - 输出：额外应激活的 entry 列表
     - 一次 LLM 调用，语义理解，全局视野
     - ~300ms，比 N 轮递归更快更智能

  3. SemanticScorer（向量相似度）
     - "搬走" 关联 "离别"，无需关键词链

  4. StateEvaluator（情绪/关系条件）
     - 纯 ST 卡无 state_conditions → 自然贡献为零

  5. TemporalEvaluator（时间条件）
     - 纯 ST 卡无 temporal_conditions → 自然贡献为零

  6. 预算管理 → 位置路由 → 注入
```

### 为什么用 System 1 替代递归

| | ST 递归扫描 | System 1 上下文扩展 |
|---|---|---|
| 机制 | 关键词链条，逐跳匹配 | 一次 LLM 调用，语义理解 |
| 延迟 | O(N) 轮，链条越长越慢 | 固定 ~300ms |
| 能力 | 只能沿关键词走 | 语义关联，全局视野 |
| 确定性 | 完全确定 | 轻微非确定（可接受） |
| 卡作者负担 | 需精心设计关键词链 | 无额外负担 |

### 保留的 ST 高级机制

- **constant**：常驻 entry → 放入 L2（会话内缓存）
- **position**：8 种注入位置，原样支持
- **depth**：atDepth 模式，插入聊天历史指定深度
- **order / weight**：排序优先级和权重
- **sticky**：触发后保持激活 N 轮
- **cooldown**：触发后冷却 N 轮
- **delay**：前 N 轮不触发
- **group**：互斥组，同组只激活得分最高的一条
- **scan_depth**：扫描聊天历史的深度

## 6. 导入流程总览

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
  ├─ mes_example → Example Dialogue
  ├─ character_book → World Info Engine 条目库
  ├─ extensions.behavioral_engine → 行为引擎参数（或默认值）
  └─ 其他 extensions → 透传存储
  │
  ▼
统一管线运行（TextScanner + System 1 扩展 + 语义 + 状态 + 时间）
```
