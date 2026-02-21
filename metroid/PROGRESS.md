# Metroid 开发进度 (2026-02-21)

## 版本: v0.3.0

## 已完成 ✅

### Phase 1: 记忆 MVP
- STM/LTM 层级 + importance 晋升
- 向量搜索 (BAAI/bge-m3, 1024维, cosine)
- GraphRAG 实体关系抽取 + 1-hop 遍历
- 4 层检索漏斗 (vector → keyword → time → scoring)
- 遗忘曲线 (importance 衰减)
- 记忆冲突仲裁 (矛盾检测 + 置信度裁决)
- Session 缓存 (L1, 高重要度预加载)
- 多用户记忆隔离 (user_id 列)

### Phase 2: 人格
- Identity Engine (Metroid Card, 灵魂锚点, 可变特质)
- Emotion Engine (PAD 模型, 间接影响, 惯性, 基线恢复)
- Growth Engine (行为变化追踪, 模式检测, LLM 评估, 审计)
- World Engine (完整 ST 兼容: selective logic, position/depth, probability, regex)
- Prompt Compiler (双模式: Classic ST / Enhanced priority-based)
- KV 缓存优化 (稳定内容前置)

### Phase 3 (部分完成): 成长与社交
- Growth Engine — 行为变化记录 + 自动观察 + 适应 ✅
- Proactive Engine — cron/idle/emotion/event 触发 + impulse 累积 ✅
- Session Engine — 跨会话连续性 + 自动上下文加载 ✅
- Feed Engine — 5 种类型 + 限流 + 情绪驱动 ✅
- Conversation Engine — 多 Agent 轮次调度 + 共享历史 ✅
- Social Engine — agent↔agent 关系管理 + 亲密度 ✅
- 双模型故障降级 — primary + fallback 自动切换 ✅
- HTTP REST API — 完整端点 + Bearer 认证 + 限流 ✅
- WebSocket — 实时推送 ✅
- 审计日志 — append-only ✅
- ST Card V2 PNG 导入 ✅
- 记忆快照导出/导入 ✅

### 基础设施
- 159 tests / 13 files, 100% 通过
- Vitest 测试框架
- SQLite (better-sqlite3) 存储
- TypeScript 全量类型

---

## 未完成 🔴

### Phase 3 剩余 (ARCHITECTURE.md 清单)

| # | 项目 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | 客观指标追踪 | P1 | 用户满意度、记忆准确率、任务完成率 |
| 2 | Agent 间消息总线 | P1 | 统一消息传递 + 审计 + 异步通信 |
| 3 | Social Engine Layer 1 补全 | P1 | @mention 识别 + 共享 public 记忆 |
| 4 | 权限分级 | P2 | user/agent/admin 三级权限 |
| 5 | 回滚机制 + UI | P2 | 基于审计日志的状态回滚 |
| 6 | 管理面板 | P2 | 记忆/情绪/成长可视化 |
| 7 | Discord Adapter | P3 | 多 Channel 支持 |

### VibeCreature 对接 (TASK-vibecreature-integration.md)

| # | 项目 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | 多用户情感隔离 | P0 | PAD 状态从 per-agent → per-(agent,user) |
| 2 | Token 消耗追踪 | P1-A | chat 响应返回 usage 字段 |
| 3 | Creature 元数据管理 | P1-B | agents 表扩展 + 新端点 |
| 4 | 好友关系 (user↔creature) | P1-C | friendships 表 + CRUD 端点 |
| 5 | 搜索/发现 API | P2-A | /discover 端点 (依赖 P1-B) |
| 6 | Feed 互动 API | P2-B | like/comment/gift + feed_reactions 表 |
| 7 | 语音集成接口 | P2-C | voiceHint 字段 (情感标注供 TTS) |

### 测试缺口

| 项目 | 说明 |
|------|------|
| HTTP adapter 集成测试 | 端点、认证、限流零覆盖 |
| WebSocket 测试 | 推送逻辑无测试 |
| Proactive Engine 测试 | 触发器 + impulse 无测试 |
| Social Engine 测试 | 关系更新无测试 |
| Memory 隐私执行 | schema 支持 3 级隐私，引擎未执行访问控制 |

### 远期 (需求驱动)

- World Engine 语义触发 + 上下文感知触发
- Social Engine Layer 2 (关系建模) / Layer 3 (群体动力学)
- Phase 0 A/B 验证实验
