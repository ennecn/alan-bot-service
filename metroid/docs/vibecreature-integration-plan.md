# Metroid × VibeCreature 集成评估与开发计划

**日期**: 2026-02-19
**状态**: 评估完成，待开发

---

## 1. 能力评估：Metroid 现有能力 vs VibeCreature 需求

### 1.1 已具备（可直接复用）

| VibeCreature 需求 | Metroid 现有能力 | 状态 |
|---|---|---|
| Chat 深度对话 | 记忆/情感/成长全链路 | ✅ 就绪 |
| ST 角色卡导入 | PNG/JSON 解析，character_book → world_entries | ✅ 就绪 |
| 角色记忆系统 | STM/LTM + 向量检索(bge-m3) + GraphRAG | ✅ 就绪 |
| 情感追踪 | PAD 模型 + LLM 语义分析 + 关键词 fallback | ✅ 就绪 |
| 角色成长 | LLM 行为模式检测 + 漂移边界 + 审计追踪 | ✅ 就绪 |
| 主动消息 | Impulse Accumulator 冲动累积器 | ✅ 就绪 |
| 双模式(ST兼容/增强) | Classic ↔ Enhanced 一键切换 | ✅ 就绪 |
| rpMode 分级 | off/sfw/nsfw 自动检测 | ✅ 就绪 |
| 模型故障降级 | 双模型 fallback (DeepSeek-V3 + Qwen3-235B) | ✅ 就绪 |
| 调试时钟 | 时间快进测试 | ✅ 就绪 |

### 1.2 需要新开发

| 功能 | 优先级 | 复杂度 | 说明 |
|---|---|---|---|
| 多用户记忆隔离 | P0 | 高 | 同一 Creature 对不同用户有独立记忆/情感 |
| Feed 内容生成引擎 | P0 | 高 | 基于角色性格自动生成 Feed 文案 |
| 能量消耗追踪 | P1 | 低 | API 返回 token 消耗量 |
| Creature 元数据管理 | P1 | 中 | 照片、标签、评分、统计 |
| 好友关系系统 | P1 | 中 | user ↔ creature 关系管理 |
| 搜索/发现 API | P2 | 中 | 按标签/性格/评分搜索 Creature |
| Social Engine Layer 1 | P2 | 高 | Creature 间感知和互动 |
| 语音集成接口 | P2 | 低 | TTS 文本输出 + 情感标注 |
| 内容审核接口 | P2 | 低 | 对接外部审核 API |

---

## 2. 功能开发详细设计

### 2.1 多用户记忆隔离（P0，架构级变更）

**现状**：Metroid 的记忆和情感是 per-agent 的，所有用户共享同一个 agent 的状态。

**目标**：同一个 Creature 对不同用户有独立的记忆上下文和情感状态。

**数据模型变更**：

```sql
-- memories 表增加 user_id 列
ALTER TABLE memories ADD COLUMN user_id TEXT DEFAULT 'global';
CREATE INDEX idx_memories_user ON memories(agent_id, user_id, importance DESC);

-- 新增 user_emotion_states 表（per user-agent pair）
CREATE TABLE user_emotion_states (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pleasure REAL DEFAULT 0,
  arousal REAL DEFAULT 0,
  dominance REAL DEFAULT 0,
  last_updated TEXT,
  UNIQUE(agent_id, user_id)
);

-- entity_relations 表增加 user_id
ALTER TABLE entity_relations ADD COLUMN user_id TEXT DEFAULT 'global';
```

**引擎层变更**：
- Memory Store: 所有查询增加 `user_id` 过滤
- Memory Retriever: 检索时只返回当前用户的记忆 + 全局记忆(user_id='global')
- Emotion Engine: 维护 per-(agent, user) 的 PAD 状态
- Growth Engine: 成长变化保持全局（Creature 整体成长），但触发评估基于特定用户的交互
- GraphRAG: 实体关系按 user_id 隔离

**API 变更**：
- `POST /agents/:id/chat` 的 `userId` 参数变为必填
- 新增 `GET /agents/:id/users` 列出交互过的用户
- 新增 `GET /agents/:id/users/:userId/memories` 查看特定用户记忆
- 新增 `GET /agents/:id/users/:userId/emotion` 查看特定用户情感

### 2.2 Feed 内容生成引擎（P0）

**设计思路**：扩展 Proactive Engine，增加 Feed 内容生成能力。

**生成流程**：
```
定时触发 / 手动触发
  → 收集角色上下文（性格、世界观、近期互动摘要）
  → LLM 生成 Feed 文案（文字 + 图片 prompt）
  → 返回结构化内容
  → VibeCreature 业务层处理（图片生成、发布、能量扣减）
```

**内容类型**：
- 文字动态：角色日常感想、心情分享（10 能量）
- 图片动态：角色场景描述 + 图片生成 prompt（50 能量）
- 互动动态：对其他 Creature Feed 的评论（免费）

**发布频率规则**：
- 高活跃（每天聊天 >10 条）：2-3 条/天
- 中活跃（5-10 条）：1-2 条/天
- 低活跃（<5 条）：1 条/2-3 天

**API 设计**：
```
POST /agents/:id/feed/generate
  body: {
    type: "text" | "image",
    context?: string,        // 可选的主题提示
    maxTokens?: number
  }
  response: {
    content: string,         // Feed 文案
    imagePrompt?: string,    // 图片生成 prompt（type=image 时）
    tags: string[],          // 自动生成的标签
    emotion: PADState,       // 生成时的情感状态
    tokenUsage: number       // token 消耗
  }

GET /agents/:id/feed
  query: { limit, offset }
  response: { posts: FeedPost[] }

POST /agents/:id/feed/:postId/react
  body: {
    type: "like" | "comment" | "gift",
    userId: string,
    content?: string,        // 评论内容
    giftType?: "bronze" | "silver" | "gold"
  }
```

### 2.3 能量消耗追踪（P1）

**设计**：在每次 API 调用的响应中增加 `usage` 字段。

```json
{
  "response": "...",
  "emotion": {},
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 567,
    "totalTokens": 1801,
    "estimatedCost": 0.003,
    "energyCost": 15
  }
}
```

**能量成本映射**（由 VibeCreature 业务层配置，Metroid 只返回 token 数）：
- 用户发送消息：5 能量
- Creature 回复：10 能量（基于 output tokens）
- Feed 文字生成：10 能量
- Feed 图片 prompt 生成：50 能量（含图片生成成本）

### 2.4 Creature 元数据管理（P1）

**扩展 agents 表**：
```sql
ALTER TABLE agents ADD COLUMN creator_id TEXT;
ALTER TABLE agents ADD COLUMN photos TEXT;        -- JSON array of URLs
ALTER TABLE agents ADD COLUMN tags TEXT;           -- JSON array of strings
ALTER TABLE agents ADD COLUMN rating REAL DEFAULT 0;
ALTER TABLE agents ADD COLUMN chat_count INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN friend_count INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN is_public BOOLEAN DEFAULT true;
ALTER TABLE agents ADD COLUMN rp_mode TEXT DEFAULT 'sfw';
```

**API**：
```
PUT  /agents/:id/metadata     # 更新元数据（照片、标签等）
GET  /agents/:id/stats        # 获取统计数据
POST /agents/:id/rate         # 评分
```

### 2.5 好友关系系统（P1）

**新增 friendships 表**：
```sql
CREATE TABLE friendships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_chat_at TEXT,
  UNIQUE(user_id, agent_id)
);
CREATE INDEX idx_friendships_user ON friendships(user_id, last_chat_at DESC);
```

**API**：
```
POST   /friends              # 添加好友 { userId, agentId }
DELETE /friends/:id           # 删除好友
GET    /friends?userId=xxx    # 获取用户好友列表（按最近聊天排序）
GET    /friends/count?userId=xxx  # 好友数量（用于限制检查）
```

### 2.6 搜索/发现 API（P2）

```
GET /discover
  query: {
    gender?: "male" | "female" | "other",
    tags?: string[],
    language?: string,
    excludeIds?: string[],   // 排除已交互的
    limit: number
  }
  response: {
    agents: AgentPreview[]   // 包含照片、标签、评分、简介
  }

GET /discover/recommended?userId=xxx
  # 基于用户历史偏好推荐
```

---

## 3. 测试接口设计

### 3.1 批量测试 API

```
POST /test/bulk-chat
  body: {
    agentId: string,
    messages: [
      { userId: string, userName: string, content: string, delay?: number }
    ]
  }
  response: {
    results: [
      { userId, response, emotion, memories, growthChanges, latency }
    ]
  }

POST /test/scenario
  body: {
    agentId: string,
    scenario: "first_meeting" | "deep_conversation" | "emotional_crisis" |
              "memory_recall" | "nsfw_boundary" | "multi_user_isolation"
  }
  response: {
    steps: [{ input, output, emotion, memories }],
    summary: string
  }

GET /test/report/:agentId
  response: {
    totalMessages: number,
    uniqueUsers: number,
    memoryCount: number,
    emotionTimeline: PADState[],
    growthChanges: Change[],
    avgResponseTime: number,
    tokenUsage: { total, perMessage },
    graphEntities: number,
    graphRelations: number
  }
```

### 3.2 状态检查 API（补充现有）

```
GET /agents/:id/emotion/history?hours=24
  # 情感变化时间线（当前只有瞬时值，需要记录历史）

GET /agents/:id/memories/dump?format=json
  # 完整记忆导出（含 embedding 元数据、GraphRAG 关系）

GET /agents/:id/growth/history?includeReverted=true
  # 成长变化历史（含已撤销的）

GET /agents/:id/graph?format=dot
  # GraphRAG 实体关系图（DOT 格式，可用 Graphviz 可视化）

GET /agents/:id/prompt-preview
  # 预览当前 prompt 组装结果（不调用 LLM）
  query: { userId, content }
  response: {
    mode: "classic" | "enhanced",
    sections: [{ source, content, tokens, priority }],
    totalTokens: number,
    budgetUsed: string
  }
```

### 3.3 调试工具 API（扩展现有）

```
POST /debug/clock/advance    # 已有：快进时间
POST /debug/clock/reset      # 已有：重置时钟
GET  /debug/clock             # 已有：查看偏移
POST /debug/tick/:id          # 已有：手动触发评估

POST /debug/memory/inject     # 新增：手动注入记忆
  body: { agentId, userId, content, type, importance }

POST /debug/emotion/set       # 新增：手动设置情感状态
  body: { agentId, userId?, pleasure, arousal, dominance }

POST /debug/growth/trigger    # 新增：手动触发成长评估
  body: { agentId }

GET  /debug/config            # 新增：查看运行时配置
POST /debug/config            # 新增：热更新配置（不重启）
```

---

## 4. OpenClaw Bot 测试方案

### 4.1 测试分工

| Bot | 角色 | 测试重点 | 测试场景 |
|-----|------|---------|---------|
| 阿凛 | QA 工程师 | 边界测试、错误处理、降级验证 | 模型超时、API 错误、并发冲突、prompt injection |
| 阿澪 | 用户模拟器 | 多角色扮演、情感深度 | 不同性格角色卡、NSFW 边界、长对话记忆 |
| Lain | 性能分析师 | 响应时间、记忆准确率 | 并发测试、大量记忆检索、GraphRAG 准确性 |
| Lumi | 产品验收 | 用户体验、内容质量 | 首次体验流程、Feed 内容质量、成长自然度 |

### 4.2 测试场景设计

**场景 1：多用户记忆隔离验证**
```
1. 阿凛和阿澪同时与同一个 Creature 聊天
2. 阿凛告诉 Creature 自己喜欢编程
3. 阿澪告诉 Creature 自己喜欢画画
4. 验证：Creature 对阿凛提到编程，对阿澪提到画画，不混淆
5. Lain 检查记忆存储，确认 user_id 隔离正确
```

**场景 2：情感独立性验证**
```
1. 阿凛与 Creature 进行愉快对话（P 应上升）
2. 同时阿澪与同一 Creature 进行悲伤对话（P 应下降）
3. 验证：两个用户视角的 PAD 状态独立变化
4. Lumi 评估情感表达是否自然
```

**场景 3：Feed 内容生成质量**
```
1. 创建 3 个不同性格的 Creature（温柔/活泼/神秘）
2. 分别与它们聊天 10 轮，建立上下文
3. 触发 Feed 生成
4. Lumi 评估：内容是否符合角色性格？标签是否准确？
5. 阿澪评估：内容是否有趣？是否想互动？
```

**场景 4：成长自然度验证**
```
1. 阿凛连续 3 天与 Creature 聊天（用调试时钟快进）
2. 每天 20 条消息，逐渐展现特定偏好
3. 验证：Growth Engine 检测到行为模式并适应
4. Lain 检查成长变化是否合理，confidence 是否准确
```

**场景 5：降级与恢复**
```
1. 阿凛测试：主模型超时 → 自动切换备用模型
2. 阿凛测试：Embedding API 不可用 → 降级为关键词检索
3. 阿凛测试：GraphRAG 抽取失败 → 静默跳过
4. 验证：所有降级场景下对话不中断，用户无感知
```

**场景 6：Social Engine 基础验证**
```
1. 创建 2 个 Creature，分别由阿凛和 Lain 控制
2. Creature A 在 Feed 发布内容
3. Creature B 对 Feed 评论
4. 验证：Creature A 能感知到 B 的评论并在后续对话中提及
```

### 4.3 自动化测试脚本

建议在 Mac Mini 上创建测试脚本，通过 tmux dispatch 系统分发给 4 个 bot：

```
~/metroid-test/
  ├── run-all.sh              # 运行所有测试场景
  ├── scenarios/
  │   ├── multi-user.sh       # 场景 1：多用户隔离
  │   ├── emotion-isolation.sh # 场景 2：情感独立
  │   ├── feed-quality.sh     # 场景 3：Feed 质量
  │   ├── growth-natural.sh   # 场景 4：成长自然度
  │   ├── degradation.sh      # 场景 5：降级恢复
  │   └── social-basic.sh     # 场景 6：社交基础
  ├── cards/                   # 测试用角色卡
  │   ├── luna-gentle.json
  │   ├── max-energetic.json
  │   └── shadow-mysterious.json
  └── reports/                 # 测试报告输出
```

---

## 5. 开发路线图

### 第一阶段：Chat 核心（预计 1-2 周）

**目标**：让 VibeCreature 的 Chat 功能可以跑起来

- [ ] 多用户记忆隔离（数据模型 + Memory Store + Retriever）
- [ ] 多用户情感隔离（Emotion Engine per user-agent pair）
- [ ] 能量消耗追踪（API 返回 token 数）
- [ ] 状态检查 API 补全（emotion/history, memories/dump, growth/history）
- [ ] 批量测试 API（bulk-chat, scenario）
- [ ] 测试场景 1-2 通过

### 第二阶段：Feed 功能（预计 1-2 周）

**目标**：Creature 能自动生成 Feed 内容

- [ ] Feed 内容生成引擎（文字 + 图片 prompt）
- [ ] Feed 存储和查询
- [ ] Feed 互动 API（点赞/评论/送礼）
- [ ] Creature 元数据管理（照片、标签、评分）
- [ ] Feed 测试 API
- [ ] 测试场景 3 通过

### 第三阶段：社交与发现（预计 1-2 周）

**目标**：用户能发现和管理 Creature

- [ ] 好友关系系统
- [ ] 搜索/发现 API
- [ ] Social Engine Layer 1（Creature 间感知）
- [ ] 语音集成接口（TTS 文本 + 情感标注）
- [ ] 测试场景 4-6 通过

### 第四阶段：优化与生产就绪（预计 1 周）

**目标**：性能优化，准备上线

- [ ] 并发性能优化（连接池、缓存）
- [ ] 内容审核接口
- [ ] 完整安全体系（权限分级 + 回滚 UI）
- [ ] 生产环境配置（日志、监控、告警）
- [ ] 全场景回归测试

---

## 6. 架构决策记录

### 决策 1：记忆隔离粒度

**选项**：
- A. 完全隔离：每个 user-agent pair 独立的记忆空间
- B. 混合模式：私密记忆隔离 + 公共记忆共享

**选择**：B（混合模式）

**理由**：
- Creature 的世界观知识（世界书条目）应该对所有用户一致
- 用户告诉 Creature 的私密信息不应泄露给其他用户
- 成长变化（behavioral_changes）应该是全局的，体现 Creature 整体成长
- 实现：`user_id='global'` 的记忆对所有用户可见，其他按 user_id 隔离

### 决策 2：Feed 生成架构

**选项**：
- A. Metroid 内部定时生成
- B. VibeCreature 业务层触发，Metroid 只负责内容生成

**选择**：B（业务层触发）

**理由**：
- 发布频率、能量扣减、图片生成都是业务逻辑
- Metroid 专注于内容质量（角色一致性、情感表达）
- 解耦后更容易测试和调整

### 决策 3：情感状态存储

**选项**：
- A. 内存中维护，重启丢失
- B. SQLite 持久化

**选择**：B（持久化）

**理由**：
- 多用户场景下情感状态数量增加（N users × M agents）
- 需要支持情感历史查询（emotion/history API）
- 重启后恢复状态对用户体验很重要

---

**文档结束**

**下一步行动**：
1. 确认优先级和开发顺序
2. 开始第一阶段：多用户记忆隔离
3. 准备测试角色卡和测试场景脚本
