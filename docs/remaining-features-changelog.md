# Alan Engine — 剩余功能实现 Changelog

## 概述

核心引擎（情绪/冲动/WI/双LLM/Prompt组装/写作质量）已完成。本次提交完成 6 项剩余功能，分 4 个工作流实现。

commit: `7c140f2`，18 files changed，463 tests all pass。

## WS1: Memory + Import + Archive

### 1A: MemoryAdapter 大小管理

**文件**: `src/action/adapters/memory.ts`

**问题**: MEMORY.md 只有 append，无大小限制，长期运行会无限增长。

**修复**: `writeOp` 执行 append 后，检查总行数。超过 200 行时按 `\n## ` 分割 entries，保留 header + 最近 150 条，重写文件。

### 1B: importCard() 接入 callImportLLM()

**文件**: `src/card-import/index.ts`

**问题**: `callImportLLM()` 已实现但只在 reimport 路由调用，首次 import 没有调用。

**修复**: `ImportOptions` 增加可选 `alanConfig`。`persistCardData()` 之后，如果 `!reimport && options?.alanConfig`，调用 `callImportLLM()`，try/catch 包裹（非致命）。

### 1C: Archive 定时清理 + Admin 端点

**文件**: `src/server/routes/admin.ts`, `src/server/engine.ts`

- `POST /admin/archive` — 调用 `chatHistory.archive()`，返回 `archived_count`
- Engine constructor 启动 24h 定时器自动执行 archive
- 新增 `destroy()` 方法清理 timer

## WS2: 情绪驱动的分段发送模式

### 2A: DeliveryMode 类型

**文件**: `src/types/actions.ts`

新增 `DeliveryMode = 'burst' | 'fragmented' | 'minimal' | 'single'`，reply action 增加可选 `delivery_mode` 字段。

### 2B: Delivery Mode Resolver

**新文件**: `src/action/adapters/delivery-modes.ts`

`resolveDeliveryMode(emotion)` 根据情绪状态决定发送模式：

| 条件 | 模式 | 行为 |
|------|------|------|
| joy > 0.7 | burst | 快速连发，300-800ms 间隔 |
| anxiety > 0.6 或 trust < 0.3 | minimal | 只发第一段 |
| sadness > 0.6 或 anger > 0.6 | single | 不分段，整条返回 |
| 其他 | fragmented | 默认分段，1000-3000ms 间隔 |

### 2C: DeliveryAdapter 更新

**文件**: `src/action/adapters/delivery.ts`

reply case 读取 `action.delivery_mode`，按 4 种模式分别处理。burst/fragmented 都走 splitMultiMessage，但 delay range 不同。minimal 只取首段，single 不分割。

### 2D: Pipeline 接入

**文件**: `src/coordinator/pipeline.ts`

构建 reply action 时调用 `resolveDeliveryMode(emotionAfter)` 设置 `delivery_mode`。

## WS3: 社交层核心接入

### 3A: Agent 注册 + 心跳 + 事件轮询

**文件**: `src/server/engine.ts`

- `registerAgent()` — 启动时 POST 到 event bus 注册
- `startSocialLoop(30s)` — 定时心跳 + 轮询事件，通过 `mapSocialEvent()` 转换后调用 `this.run()`
- `stopSocialLoop()` — 清理 interval
- 如果 `event_bus_url` 未配置，所有社交功能静默跳过

### 3B: 社交事件映射器

**新文件**: `src/social/event-mapper.ts`

`mapSocialEvent(SocialEvent) → CoordinatorEvent | null`：

| 事件类型 | 触发器 | 内容格式 |
|----------|--------|----------|
| social_post | social_notification | `[Social] {agent} posted: {content}` |
| fact_update | fact_sync | `[FactSync] {agent}: {content}` |
| reaction | social_notification | `[Social] {agent} reacted: {type} — {content}` |
| life_event | social_notification | `[LifeEvent] {agent}: {content}` |
| 其他 | — | 返回 null |

### 3C: Prompt Assembly 注入社交上下文

**文件**: `src/coordinator/prompt-assembler.ts`

`AssemblyParams` 增加 `socialContext?: string`。L3 层注入位置：`framedNarrative` 和 `activatedWI` 之间。

### 3D: Pipeline 获取社交上下文

**文件**: `src/coordinator/pipeline.ts`

`assemble()` 调用前，如果 `event_bus_url` 存在，fetch 最近 5 条 posts，格式化为 `## Recent Social Activity` 文本传入。

## WS4: S1 社交扩展 + LifeSimulation 端点

### 4A: S1 Schema 扩展

**文件**: `src/coordinator/system1/schema.ts`

`PROCESS_EVENT_TOOL` 增加可选 `social_actions` 属性：
- `should_post`, `post_content`, `post_mood` — 发朋友圈
- `should_react`, `react_target`, `react_type`, `react_content` — 点赞/评论

不加入 required 数组，保持可选。

### 4B: System1Output 类型扩展

**文件**: `src/types/index.ts`

`System1Output` 增加可选 `social_actions?` 字段，类型与 schema 对应。

### 4C: Pipeline 生成社交 Action

**文件**: `src/coordinator/pipeline.ts`

memoryActions 之后，根据 `system1Output.social_actions` 生成：
- `should_post` → `post_moment` action
- `should_react + comment` → `comment` action
- `should_react + like` → `like` action

合并到最终 actions 数组。

### 4D: S1 Prompt 社交提示

**文件**: `src/coordinator/system1/prompt.ts`

指令增加一行："If social context is provided, you may optionally decide to post a moment or react via social_actions. Only post when genuinely motivated."

### 4E: LifeSimulation Admin 端点

**文件**: `src/server/routes/admin.ts`

`POST /admin/life-simulate` — 构造 cron 事件调用 `engine.run()`，返回 decision + action types。用于定时触发角色自主活动。

## 新增测试文件

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| `action/__tests__/memory.test.ts` | 4 | 创建、追加、大小裁剪、非法 action |
| `action/__tests__/delivery-modes.test.ts` | 8 | 4 种模式 + 优先级 |
| `action/__tests__/delivery.test.ts` | +4 | burst/fragmented/minimal/single 模式 |
| `social/__tests__/event-mapper.test.ts` | 6 | 4 种事件映射 + unknown + timestamp |
| `coordinator/system1/__tests__/system1-social.test.ts` | 10 | schema/type/action 生成逻辑 |

总计：463 tests, 35 files, all pass。
