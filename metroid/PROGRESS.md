# Metroid 开发进度 (2026-02-23)

## 版本: v0.4.0

## 代码同步记录

### 2026-02-21 Mac Mini → Windows 同步
- 源: Mac Mini `/Users/fangjin/metroid-local/` (主开发环境)
- 目标: Windows `D:\openclawVPS\metroid\` (git 仓库) + NAS `Z:\openclawVPS\metroid\` (备份)
- Git commit: `80aeed3`
- 分支 `metroid-admin-panel` (c2c5c3f) 保留了 Windows 独有功能:
  - Debug console admin panel (Dashboard/Emotions/Memories/Growth 4 tabs)
  - Rate limiting (滑动窗口限流)
  - Input sanitization + body size 限制
  - API token 认证
  - 6 个管理 API 端点 (memory stats, entity relations, emotion history/users, growth revert)
- 这些功能后续需合并回 master

### 开发环境
| 环境 | 路径 | 用途 |
|------|------|------|
| Mac Mini | `/Users/fangjin/metroid-local/` | 主开发 + 运行测试 |
| Windows | `D:\openclawVPS\metroid\` | Git 仓库 + Claude Code 开发 |
| NAS (Z:) | `Z:\openclawVPS\metroid\` | 备份 |
| Mac NAS mount | `/Users/fangjin/nas/openclawVPS/metroid/` | Mac 访问 NAS |

---

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
- HTTP REST API — 完整端点 ✅
- WebSocket — 实时推送 ✅
- 审计日志 — append-only ✅
- ST Card V2 PNG 导入 ✅
- 记忆快照导出/导入 ✅

### Mac Mini 开发成果 (2026-02-16 ~ 02-20)
- OpenAI 兼容 API (SiliconFlow/DeepSeek-V3/Qwen2.5-72B)
- rpMode 三级 RP 指令 (off/sfw/nsfw)
- Emotion Engine 修复: PAD 全 0 问题, 中文正负面关键词扩展, onResponse 分析 LLM 回复, intensityDial 0.5→0.8
- Growth Engine 修复: 中文短消息阈值 20→10, CJK 字符段分词, 疑问句频率检测 (Pattern 5)
- LLM 语义分析: emotion + growth 引擎均支持 LLM 替代关键词匹配
- 用户身份修复: EngineContext 新增 userName, baseSystemPrompt 加入身份锚定
- Debug Clock: advanceTime/resetClock 支持时间旅行测试 impulse 系统
- Web-IM adapter: 手写 WebSocket (零依赖)
- ST vs Metroid 对比测试框架 (芙莉莲角色卡, 5 轮对话)

### Proactive Engine V2 — 行为模型增强 (2026-02-22)
- 设计文档: `metroid/docs/proactive-v2-design.md`
- 核心目标: impulse 触发时的 LLM prompt 从薄弱的 "P=0.3 A=0.1" 变成富含上下文的结构化舞台指令
- 类型扩展: ActiveEvent.relevance, ImpulseSignal.emotion_pressure, MetroidCard.emotion.moodInertia/longTermDimensions
- DB: 新增 long_term_mood 表, 放宽 trigger_type CHECK (impulse:idle/emotion/mixed), 含迁移脚本
- 引擎改动:
  - evaluateAll 快照一致性修复 (手动 tick 也录入快照)
  - computeTrajectory() — 情绪轨迹计算 (rising/falling/stable)
  - 事件 relevance — eventGate 改为 max(intensity × relevance)
  - emotion_pressure 信号 — 纯情绪偏离基线驱动, 不受 eventGate 门控
  - 长期情绪 — EMA 更新 + DB 持久化 (会话结束时写入)
  - 对话事件冷却 — 10 分钟内重复事件降低 50% intensity
  - fireImpulse prompt V2 — 结构化 XML (轨迹/长期情绪/事件+relevance/抑制历史/沉默时长)
  - triggerType 细化 — 基于 dominant signal 动态决定 (impulse:idle/emotion/mixed)
- 测试: 84 → 114 (30 个新 V2 测试, 全部通过)

### Proactive Engine V3 — 去重 + 反馈回路 + 事件检测 (2026-02-23)
- 三大 critical gaps 修复: 消息去重、用户反馈回路、上下文感知事件检测
- **Feature 1: 消息去重**
  - `isDuplicate()` — embedding cosine similarity (>0.85) + bigram Jaccard fallback (>0.7)
  - 复用 EmbeddingService, 内存 embedding cache (Map<messageId, Float32Array>)
  - fireImpulse/fireTrigger 插入前自动检查, 跳过重复消息
  - 对比范围: pending messages + 最近 30 分钟已投递消息
- **Feature 2: 用户反馈回路**
  - DB: 新增 `proactive_reactions` 表 (engaged/ignored/dismissed) + `proactive_preferences` 表
  - `proactive_messages` 新增 `delivered_at` 列, markDelivered 同时写入时间戳
  - 自动反应检测: onResponse 中检查未标记的已投递消息 → engaged; evaluateAll 中超时 → ignored
  - 自适应 threshold: 从 proactive_preferences 读取, 低 engagement → 提高阈值, 高 → 降低
  - 权重调整: 每 10 次反应重新计算 per-triggerType engaged 率, 调整信号权重
- **Feature 3: 上下文感知事件检测**
  - Hybrid 模式: regex 快筛 → LLM 确认 (仅 llmVerify=true 的事件)
  - `detectEventsWithLLM()` — 构建 prompt 含消息+上下文+候选, LLM 返回 JSON 确认/否定/新发现
  - `setAnalyzeFn()` — 轻量 LLM 回调, 由 Metroid 主类注入
  - 新增 6 个事件模式: frustration, excitement, gratitude, apology, anxiety, nostalgia
  - ActiveEvent.confidence 字段, eventGate 改为 max(intensity × relevance × confidence)
  - LLM 不可用时 graceful degradation 到 regex 结果
- 测试: 114 → 142 (28 个新 V3 测试, 全部通过)

### 基础设施
- 13 test files, Vitest 框架
- SQLite (better-sqlite3) 存储
- TypeScript 全量类型
- 代码量: ~3785 行核心代码 (src/)

### 测试现状 (2026-02-23)
| 状态 | 数量 | 说明 |
|------|------|------|
| Passed | 142 | 核心引擎测试 (含 30 个 V2 + 28 个 V3 新测试) |
| Failed | 4 | forgetter (NOT NULL 约束) ×2, growth (行为检测断言) ×2 |
| Skipped | 41 | comparison.test.ts (需 sillytavern_test/ 数据) |

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
| 6 | 管理面板 | P2 | 记忆/情绪/成长可视化 (已有原型在 metroid-admin-panel 分支) |
| 7 | Discord Adapter | P3 | 多 Channel 支持 |

### 安全功能 (需从 metroid-admin-panel 分支合并)

| 项目 | 说明 |
|------|------|
| Rate Limiting | 滑动窗口限流 (60/min mutation, 600/min read) |
| Input Sanitization | 字符串 trim + maxLen 截断 |
| Body Size Limit | 1MB 请求体限制 |
| API Token Auth | Bearer token 认证 |

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
| Proactive Engine 测试 | ✅ 142 tests (V1 84 + V2 30 + V3 28), 全覆盖 |
| HTTP adapter 集成测试 | 端点、认证、限流零覆盖 |
| WebSocket 测试 | 推送逻辑无测试 |
| Social Engine 测试 | 关系更新无测试 |
| Memory 隐私执行 | schema 支持 3 级隐私，引擎未执行访问控制 |
| forgetter bug | NOT NULL 约束冲突 (updateImportance SQL 参数顺序) |
| growth bug | 行为检测断言失败 (changes.length = 0) |

### 远期 (需求驱动)

- World Engine 语义触发 + 上下文感知触发
- Social Engine Layer 2 (关系建模) / Layer 3 (群体动力学)
- Phase 0 A/B 验证实验
