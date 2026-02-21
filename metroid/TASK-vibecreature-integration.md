# 任务：Metroid × VibeCreature 对接开发

**日期**: 2026-02-21
**目标**: 补齐 Metroid 缺失的 VC 对接能力，让 VibeCreature 前端能接入 Metroid 后端

---

## 背景

### VibeCreature
- **项目位置**: `D:\openclawVPS\vibecreature\vc-front-preview\`
- **技术栈**: Next.js 16 + Tailwind CSS + shadcn/ui + Framer Motion
- **产品**: AI 陪伴社交应用（类 Character.AI，Tinder 式发现交互）
- **页面**: 发现(Tinder滑动) / 聊天 / 好友 / Feed动态 / 创造 / 个人中心 / 支付
- **现状**: 纯前端 mock 数据（`src/data/mock.ts`），无后端
- **部署**: VPS 138.68.44.141:3000 (systemd: vc-preview)

### Metroid (v0.3.0)
- **项目位置**: `D:\openclawVPS\metroid\`
- **现状**: 159 tests，12 个引擎全部实现
- **HTTP API**: 端口 8100，完整 REST + WebSocket

### 详细集成计划
- **参考文档**: `D:\openclawVPS\vibecreature-integration-plan.md`（500 行，非常详细）
- 包含数据模型变更、API 设计、测试场景、架构决策

---

## 已具备 vs 需开发

### ✅ 已具备（直接可用）
| 能力 | Metroid 模块 | 说明 |
|------|-------------|------|
| Chat 深度对话 | Memory + Emotion + Growth | 全链路就绪 |
| 多用户记忆隔离 | MemoryStore (user_id 列) | Sprint 1 已实现 |
| Feed 生成 | FeedEngine | 5 种类型 (thought/mood/milestone/memory_echo/reflection) |
| 社交关系 (agent↔agent) | SocialEngine | 关系管理 + 亲密度 |
| 会话连续性 | SessionEngine | 跨会话自动加载上下文 |
| 记忆快照 | snapshot.ts | 导出/导入 |
| 认证 + 限流 | HTTP Adapter | Bearer token + 滑动窗口 |
| 记忆冲突仲裁 | ConflictArbiter | 矛盾检测 + 置信度裁决 |
| 多 Agent 对话 | ConversationEngine | 轮次调度 + 共享历史 |

### 🔴 需要开发（按优先级）

#### P0: 多用户情感隔离
- **现状**: EmotionEngine 的 PAD 状态是 per-agent 的（内存 Map）
- **目标**: per-(agent, user) 独立 PAD 状态
- **改动文件**:
  - `src/engines/emotion/index.ts` — 状态 key 从 `agentId` 改为 `agentId:userId`
  - `src/db/index.ts` — 新增 `user_emotion_states` 表
  - `src/db/schema.sql` — DDL
  - `src/types.ts` — EmotionState 增加 userId
  - `src/index.ts` — chat() 传递 userId 给 EmotionEngine
  - `src/adapter/http.ts` — emotion 端点支持 `?userId=xxx` 查询
- **数据模型**:
  ```sql
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
  ```
- **测试**: 两个用户同时与同一 agent 聊天，验证 PAD 状态独立变化

#### P1-A: Token/能量消耗追踪
- **现状**: chat 响应不返回 token 使用量
- **目标**: 每次 API 调用返回 `usage` 字段
- **改动文件**:
  - `src/index.ts` — chat() 返回值增加 usage
  - `src/compiler/index.ts` — 记录 input/output tokens
  - `src/adapter/http.ts` — 响应体增加 usage
- **响应格式**:
  ```json
  {
    "response": "...",
    "emotion": {},
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 567,
      "totalTokens": 1801
    }
  }
  ```
- VC 业务层负责 token → 能量的映射，Metroid 只返回 token 数

#### P1-B: Creature 元数据管理
- **现状**: agents 表只有基础字段 (id, name, card_json, mode)
- **目标**: 扩展 agents 表支持 VC 需要的元数据
- **改动文件**:
  - `src/db/index.ts` — ALTER TABLE 迁移
  - `src/db/schema.sql` — 新列
  - `src/adapter/http.ts` — 新端点
- **新增列**:
  ```sql
  ALTER TABLE agents ADD COLUMN creator_id TEXT;
  ALTER TABLE agents ADD COLUMN photos TEXT;        -- JSON array of URLs
  ALTER TABLE agents ADD COLUMN tags TEXT;           -- JSON array
  ALTER TABLE agents ADD COLUMN rating REAL DEFAULT 0;
  ALTER TABLE agents ADD COLUMN chat_count INTEGER DEFAULT 0;
  ALTER TABLE agents ADD COLUMN friend_count INTEGER DEFAULT 0;
  ALTER TABLE agents ADD COLUMN is_public BOOLEAN DEFAULT true;
  ```
- **新端点**:
  ```
  PUT  /agents/:id/metadata     { photos?, tags?, isPublic? }
  GET  /agents/:id/stats        → { chatCount, friendCount, rating, ... }
  POST /agents/:id/rate         { userId, score }
  ```

#### P1-C: 好友关系 (user↔creature)
- **现状**: SocialEngine 管理 agent↔agent 关系，没有 user↔agent
- **目标**: 用户可以添加/删除 Creature 好友
- **改动文件**:
  - `src/db/index.ts` — 新表 friendships
  - `src/db/schema.sql` — DDL
  - `src/adapter/http.ts` — 新端点
- **数据模型**:
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
- **新端点**:
  ```
  POST   /friends              { userId, agentId }
  DELETE /friends/:id
  GET    /friends?userId=xxx   → 按最近聊天排序
  ```

#### P2-A: 搜索/发现 API
- **新端点**:
  ```
  GET /discover?gender=&tags=&language=&limit=10&excludeIds=
  GET /discover/recommended?userId=xxx
  ```
- 依赖 P1-B (元数据) 完成后才能实现

#### P2-B: Feed 互动 API
- **现状**: FeedEngine 只有生成和查询，没有互动
- **新端点**:
  ```
  POST /agents/:id/feed/:postId/react  { type: "like"|"comment"|"gift", userId, content? }
  ```
- 需要新表 `feed_reactions`

#### P2-C: 语音集成接口
- chat 响应增加 `voiceHint` 字段（情感标注，供 TTS 调整语调）
- 格式: `{ emotion: "happy", intensity: 0.7, speed: 1.1 }`

---

## 开发顺序建议

```
P0: 多用户情感隔离
  ↓
P1-A: Token 消耗追踪  (独立，可并行)
P1-B: Creature 元数据  (独立，可并行)
P1-C: 好友关系系统     (独立，可并行)
  ↓
P2-A: 搜索/发现 API   (依赖 P1-B)
P2-B: Feed 互动       (独立)
P2-C: 语音集成         (独立)
  ↓
前端对接: 替换 vc-front-preview 的 mock 数据为 Metroid API
```

---

## 关键文件索引

### Metroid 核心文件（几乎每个任务都会改）
| 文件 | 角色 |
|------|------|
| `src/index.ts` | 主编排器，所有引擎的入口 |
| `src/adapter/http.ts` | HTTP API 层，所有端点定义 |
| `src/types.ts` | 类型定义 |
| `src/db/index.ts` | 数据库连接 + 迁移 |
| `src/db/schema.sql` | 数据库 Schema |
| `src/config.ts` | 配置 |

### Metroid 引擎文件（按任务涉及）
| 文件 | 涉及任务 |
|------|---------|
| `src/engines/emotion/index.ts` | P0 (情感隔离) |
| `src/engines/memory/index.ts` | 已有 user_id 隔离 |
| `src/engines/memory/store.ts` | 已有 user_id 隔离 |
| `src/engines/memory/retriever.ts` | 已有 user_id 隔离 |
| `src/engines/feed/index.ts` | P2-B (Feed 互动) |
| `src/engines/social/index.ts` | 参考其 agent↔agent 模式 |
| `src/compiler/index.ts` | P1-A (token 计数) |

### VibeCreature 前端文件
| 文件 | 说明 |
|------|------|
| `vc-front-preview/src/data/mock.ts` | Mock 数据，最终要替换为 API 调用 |
| `vc-front-preview/src/app/chat/[id]/page.tsx` | 聊天页，对接 chat API |
| `vc-front-preview/src/app/discover/page.tsx` | 发现页，对接 discover API |
| `vc-front-preview/src/app/feed/page.tsx` | 动态页，对接 feed API |
| `vc-front-preview/src/app/friends/page.tsx` | 好友页，对接 friends API |
| `vc-front-preview/src/app/payment/page.tsx` | 支付页，对接能量系统 |

---

## 测试策略

每完成一个 P 级任务后：
1. `cd D:\openclawVPS\metroid && npx vitest run` — 确保现有 159 tests 不回归
2. 为新功能添加测试到 `tests/` 目录
3. 手动用 curl 验证新端点

### 验收测试场景（来自集成计划）

**场景 1: 多用户情感隔离** (P0 完成后)
```bash
# 用户 A 发送开心消息
curl http://127.0.0.1:8100/agents/AGENT/chat \
  -d '{"content":"太开心了！","userId":"user-a"}'

# 用户 B 发送悲伤消息
curl http://127.0.0.1:8100/agents/AGENT/chat \
  -d '{"content":"好难过...","userId":"user-b"}'

# 验证情感独立
curl http://127.0.0.1:8100/agents/AGENT/emotion?userId=user-a  # P 应为正
curl http://127.0.0.1:8100/agents/AGENT/emotion?userId=user-b  # P 应为负
```

**场景 2: Token 追踪** (P1-A 完成后)
```bash
curl http://127.0.0.1:8100/agents/AGENT/chat \
  -d '{"content":"hello"}'
# 响应应包含 usage.inputTokens, usage.outputTokens
```

---

## 环境信息

- Metroid 运行: `cd D:\openclawVPS\metroid && ANTHROPIC_API_KEY=xxx npm run serve`
- 默认端口: 8100
- 测试: `npx vitest run`
- VC 前端: `cd D:\openclawVPS\vibecreature\vc-front-preview && npm run dev`
- 详细集成计划: `D:\openclawVPS\vibecreature-integration-plan.md`
