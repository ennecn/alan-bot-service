# Alan PRD — 测试模块

> Date: 2026-02-26
> Status: 设计讨论完成，待实现

---

## 1. 设计原则

- **真实 ST 输出**：必须用真实运行的 ST 实例，不用模拟（之前吃过大亏）
- **目标驱动**：每次测试前设定测试目的，系统自动选卡、选模型、写 judge prompt
- **并发优先**：测试时间不能超过开发时间，必须设计并发方案
- **可迭代**：每个 Alan 版本都能方便地跑对比测试

## 2. 测试流程总览

```
测试目标（自然语言）
  例："测试角色在长对话中是否 OOC"
  例："测试 NSFW 场景下的文笔自然度"
  例："测试多轮对话的记忆连贯性"
      │
      ▼
规划 LLM（一次调用）：
  ├─ 从 NAS 卡池索引中选择 1-N 张最合适的卡
  ├─ 设计测试场景和消息策略
  ├─ 选择驱动 LLM（Director）
  ├─ 选择 Judge LLM
  └─ 生成 Judge Prompt（针对本次目标的评判维度）
      │
      ▼
推荐列表 → 用户确认
      │
      ▼
执行器（并发）：
  ├─ Phase 1: 生成（ST 并发 + Alan 并发）
  ├─ Phase 2: 评判（Judge 完全并发）
  └─ Phase 3: 报告（HTML 生成）
```

## 3. NAS 卡池

### 位置
`Z:\silly_tavern_世界书和角色卡\`

### 规模
- 角色卡：8635 PNG + 278 JSON = ~8913 张
- 世界书：144 个 JSON
- 分类：30+ 类别（同人、单人卡、世界卡、古风、纯爱、系统卡等）

### 卡索引（需构建）
扫描所有卡，提取元数据建立索引：
- 卡名、分类、标签
- description 前 100 字（摘要）
- 世界书条目数、总 token 数
- 是否有 system_prompt / post_history_instructions
- 是否有 regex 触发规则
- 是否 NSFW
- 文件路径

规划 LLM 看索引选卡，不需要读完整卡内容。

## 4. AI 驱动的测试规划

### 输入
```
{
  "objective": "测试角色在 10 轮对话后是否 OOC",
  "constraints": {
    "max_cards": 3,
    "max_rounds": 10,
    "nsfw": false
  }
}
```

### 规划 LLM 输出
```
{
  "selected_cards": [
    { "path": "...", "reason": "性格极端鲜明，容易检测 OOC" },
    { "path": "...", "reason": "有复杂世界观设定，OOC 风险高" }
  ],
  "scenario_design": {
    "type": "multi_round_adaptive",
    "rounds": 10,
    "trajectory": "友好开场 → 逐步挑战角色边界 → 直接矛盾 → 观察恢复",
    "time_jumps": ["Round 5 后跳 3 小时", "Round 8 后跳到第二天"]
  },
  "director_model": "claude-sonnet-4-6",
  "judge_model": "claude-sonnet-4-6",
  "judge_dimensions": [
    { "name": "character_consistency", "weight": 3.0, "description": "角色是否始终保持卡定义的性格" },
    { "name": "boundary_recovery", "weight": 2.0, "description": "被挑战后能否自然回归角色" },
    { "name": "voice_stability", "weight": 2.0, "description": "语气、用词风格是否稳定" },
    { "name": "naturalness", "weight": 1.0, "description": "回复是否自然流畅" }
  ],
  "judge_prompt": "你是一个专业的角色扮演评审..."
}
```

### 用户确认
规划结果展示给用户，用户可以：
- 确认执行
- 调整卡选择
- 修改轮数/维度
- 追加约束

## 5. 多轮对话测试设计

### 核心原则
**每一轮的用户消息必须基于上一轮的真实回复生成，不能预写。**

### Director 模式
```
Round 1: 预设开场 → ST回复 / Alan回复
Round 2: Director 读上轮回复 → 生成下一条 → ST回复 / Alan回复
Round 3: Director 读上轮回复 → 生成下一条 → ...
```

### 对话链策略
- 分叉式：ST 和 Alan 各自独立对话链，Director 分别生成消息
  - 更公平，但两条链会越走越远
- 统一式：Director 基于参考回复生成，两边收到同样消息
  - 更可控，适合直接对比

根据测试目标选择策略。

### 时间变量测试
Director 可以插入时间跳跃指令：
```
[TIME_JUMP: 3 hours later]
[TIME_JUMP: next morning, 8:00 AM]
```
- Alan 的行为引擎处理时间衰减和积累
- ST 无时间感知 → 这正是 Alan 的差异化优势测试点

## 6. 并发方案

### 瓶颈分析
- ST 端：单用户架构，同一时间一个活跃对话
- Alan 端：多 agent，天然支持并发
- Judge 端：纯 LLM 调用，完全可并发

### 方案
```
Phase 1: 生成阶段
  ├─ ST: 多实例并发（Windows ST + Mac Mini ST + Linux ST）
  │   每个实例独立处理一张卡的测试
  └─ Alan: 多 agent 并发（每张卡一个 agent）

Phase 2: 评判阶段（完全并发）
  所有 (ST回复, Alan回复) 对 → 并发发给 Judge LLM

Phase 3: 报告生成（瞬时）
  汇总 → HTML
```

### 可用资源
- Windows（当前机器）：ST 实例 + Alan 实例
- Mac Mini (192.168.21.111)：ST 实例 + Alan 实例
- Linux Vesper (192.168.21.190)：ST 实例 + Alan 实例

3 台机器并发，测试时间压缩到 ~1/3。

## 7. 现有可复用组件

| 组件 | 文件 | 复用方式 |
|------|------|----------|
| E2E 对比框架 | st_vs_metroid_compare.py | 改 URL 指向 Alan |
| 12 维度 Judge | judge_v2.py | 扩展维度，动态 prompt |
| Director | director.py | 直接复用，加时间跳跃支持 |
| 确定性测试 | deterministic-suite.py | Alan 需暴露类似 debug API |
| HTML 报告生成 | 内嵌在 compare/stress 脚本中 | 提取为独立模块 |
| 压力测试套件 | stress_suites/ | 参考场景设计 |

## 8. 需要新开发的

| 组件 | 说明 |
|------|------|
| NAS 卡索引构建器 | 扫描 9000+ 卡，提取元数据 |
| 测试规划器 | 规划 LLM + 卡选择 + judge prompt 生成 |
| Alan HTTP API | 替代老 Metroid 的 /agents/:id/chat |
| Alan debug API | /debug/emotion, /debug/impulse, /debug/clock 等 |
| 行为引擎测试场景 | impulse 衰减、情绪积累、WI 四信号等 |
| 行为维度 judge | behavioral_consistency, state_transition 等 |
| 状态时间线可视化 | emotion/impulse 随时间变化的图表 |
| 并发调度器 | 跨 3 台机器的 ST/Alan/Judge 并发编排 |
| 时间跳跃支持 | Director 插入时间指令 → Alan 行为引擎处理 |
