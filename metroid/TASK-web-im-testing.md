# 任务：web-im + Metroid 测试体系建设

**日期**: 2026-02-21
**目标**: 给 web-im 项目建立测试基础设施，并完成与 Metroid 的集成测试

---

## 背景

### web-im 项目
- **位置**: `D:\openclawVPS\web-im\`
- **技术栈**: Next.js 16 + React 19 + Prisma 7 (SQLite) + Zustand + shadcn/ui + Tailwind CSS 4
- **功能**: Web 聊天界面，支持用户登录、群聊、@bot mention routing
- **现状**: 功能开发完成，**零测试覆盖**（无 Jest/Vitest/Playwright）

### Metroid 项目
- **位置**: `D:\openclawVPS\metroid\`
- **技术栈**: TypeScript + SQLite (better-sqlite3) + Vitest
- **现状**: v0.3.0，159 tests / 13 files，100% 通过
- **HTTP API**: 端口 8100，REST + WebSocket，Bearer token 认证
- **API 文档**: `metroid/README.md` 有完整端点列表

### 两者关系
- web-im 通过 HTTP API 调用 Metroid（`src/lib/openclaw.ts` + `src/components/openclaw-provider.tsx`）
- 目前 web-im 用 mock 数据，未真正对接 Metroid API

---

## 任务清单

### Phase 1: web-im 测试基础设施 (优先)

1. **安装测试依赖**
   ```bash
   cd D:\openclawVPS\web-im
   npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
   ```

2. **配置 Vitest** — 创建 `vitest.config.ts`
   - 使用 jsdom 环境
   - 配置 path aliases 匹配 tsconfig
   - 设置 setupFiles 引入 @testing-library/jest-dom

3. **在 package.json 添加 test script**
   ```json
   "test": "vitest run",
   "test:watch": "vitest"
   ```

### Phase 2: 核心单元测试

优先测试这些文件（按重要性排序）：

1. **`src/lib/auth.ts`** — 认证逻辑
   - 密码哈希/验证
   - Session cookie 创建/验证
   - 登录/登出流程

2. **`src/lib/openclaw.ts`** — Metroid API 客户端
   - 请求构造（URL、headers、body）
   - 响应解析
   - 错误处理
   - Mock fetch 测试各种响应场景

3. **`src/stores/useStore.ts`** — Zustand store
   - 状态初始化
   - Action 行为
   - 消息发送/接收流程

4. **`src/components/chat-interface.tsx`** — 聊天组件
   - 消息渲染
   - 输入框交互
   - @mention 路由逻辑

### Phase 3: Metroid 集成测试

在 `web-im/tests/integration/` 下创建：

1. **`metroid-api.test.ts`** — 直接测试 Metroid HTTP API
   - 前提：启动 Metroid server（`ANTHROPIC_API_KEY=test npm run serve`）
   - 测试 agent CRUD
   - 测试 chat 端点（可以 mock LLM 响应）
   - 测试 emotion/memories/growth 查询
   - 测试 session 管理
   - 测试 feed 生成

2. **`openclaw-client.test.ts`** — 测试 web-im 的 API 客户端层
   - Mock Metroid server 响应
   - 验证请求格式正确
   - 验证错误处理（网络错误、401、500）
   - 验证重试逻辑（如果有）

### Phase 4: E2E 测试 (可选，后续)

如果时间允许：
- 安装 Playwright
- 测试登录流程
- 测试聊天发送/接收
- 测试 @bot mention 路由

---

## 关键文件索引

### web-im 核心文件
```
src/
├── app/
│   ├── api/           # Next.js API routes (后端)
│   ├── login/page.tsx # 登录页
│   └── page.tsx       # 主页
├── components/
│   ├── auth-provider.tsx      # 认证上下文
│   ├── chat-interface.tsx     # 聊天核心组件
│   ├── debug-panel.tsx        # 调试面板
│   ├── openclaw-provider.tsx  # Metroid API 上下文
│   └── top-nav.tsx            # 导航栏
├── lib/
│   ├── auth.ts        # 认证工具函数
│   ├── db.ts          # Prisma 数据库
│   ├── openclaw.ts    # Metroid API 客户端 ⭐
│   └── utils.ts       # 通用工具
├── stores/
│   └── useStore.ts    # Zustand 状态管理
├── types/             # TypeScript 类型
└── middleware.ts      # Next.js 中间件（认证检查）
```

### Metroid API 端点 (port 8100)
```
GET  /health
GET  /agents
POST /agents                    { name, card, mode? }
GET  /agents/:id
POST /agents/:id/mode           { mode }
POST /agents/:id/chat           { content, userId?, userName?, sessionId?, history? }
GET  /agents/:id/emotion
GET  /agents/:id/memories       ?limit=10
GET  /agents/:id/growth
GET  /agents/:id/relationships
POST /agents/:id/relationships  { targetAgentId, type, affinity }
POST /agents/:id/sessions       { userId, contextTail? }
GET  /agents/:id/sessions       ?limit=10
GET  /agents/:id/feed           ?limit=20
POST /agents/:id/feed/generate
GET  /agents/:id/config
POST /agents/:id/config         { ...partial config }
GET  /agents/:id/prompt-inspect ?userId=xxx
```

### 认证
- 设置 `METROID_API_TOKEN` 环境变量后，所有请求需 `Authorization: Bearer TOKEN`
- `/health` 不需要认证

---

## 注意事项

- web-im 使用 Next.js 16 App Router，测试 Server Components 需要特殊处理
- Prisma 7 使用 better-sqlite3，测试时可以用内存数据库
- Metroid 的 chat 端点需要 LLM API key 才能真正工作，集成测试可以：
  - 方案 A: Mock LLM 响应（推荐，不依赖外部服务）
  - 方案 B: 使用真实 API（需要 ANTHROPIC_API_KEY）
- 测试文件放在 `web-im/tests/` 或 `web-im/src/__tests__/`，保持一致
