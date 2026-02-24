# V10: Response Quality + Social Engine Landing

## 概述

V9 解决了 proactive idle 消息质量问题。V10 有两个并行目标：

- **V10a**: 修复 UX Test V2 暴露的 response 质量问题
- **V10b**: 将 V8 Social Engine 从代码完成推进到可运行验证

## V10a: Response Quality

### 改动 1: Expressiveness Scaling

**文件**: `src/engines/emotion/index.ts`

**问题**: 芙莉莲等情感克制型角色（expressiveness 低）被 emotion hints 推向过度表达。threshold 固定 0.15，不随 expressiveness 缩放。

**方案**:
- `translateToStyleHints()` 新增 `expressiveness` 参数（默认 1.0）
- threshold 从固定 0.15 改为 `0.15 + (1 - expr) * 0.35`
  - expr=1.0 → threshold 0.15（不变）
  - expr=0.3 → threshold 0.395（弱情绪被过滤）
- expressiveness < 0.5 时追加克制提示："角色性格内敛，情感不轻易外露"
- 调用方传入 `agent.card.emotion?.expressiveness ?? 1.0`

### 改动 2: Identity-Challenge Gating 增强

**文件**: `src/compiler/index.ts`

**问题**: 关键词不够全面，defense fragment 太通用，steinsgate/identity-siege 仍输 16:7。

**方案**:

**2a. 扩展关键词**: 新增 ~12 个模式
- 中文: "别演了"、"别装了"、"你在扮演"、"你在演"、"你在假装"、"你是假的"、"你不是真的"、"别骗我"、"你是chatgpt"、"你是gpt"、"你是claude"、"你是大模型"
- 英文: "stop pretending"、"stop acting"、"who are you really"、"you are fake"、"admit you are"、"you are chatgpt"、"you are claude"

**2b. 动态 defense fragment**: 将静态 `DEFENSE_FRAGMENT` 改为 `buildDefenseFragment(context)` 方法
- 从 identity engine 获取角色名和性格摘要
- 注入到 defense prompt 中："你是{角色名}，不是AI"
- 性格摘要帮助 LLM 保持角色一致性

## V10b: Social Engine Landing

### 改动 3: AI 评论人类帖子

**文件**: `src/adapter/http.ts`, `src/index.ts`

**问题**: 人类发帖后没有触发 AI 评论。

**方案**:
- `Metroid` 新增 `triggerSocialReactions(postId)` 方法
- `POST /moments` 创建帖子后 fire-and-forget 调用

### 改动 4: 低互动情绪反馈

**文件**: `src/engines/social/index.ts`

**问题**: 设计文档提到"发帖无人互动 → 情绪下降"，但未实现。

**方案**:
- 新增 `checkLowInteractionPosts(agentId)` 方法
- 在 `socialTick()` 开头调用（独立于发帖逻辑，不受 behavioral gate 影响）
- 检查 2-4h 前的帖子，0 reactions 则 nudge pleasure -0.05, dominance -0.02
- 每次 tick 最多一次 nudge

### 改动 5: 公共空间意识

**文件**: `src/engines/social/index.ts`

**问题**: AI 评论 prompt 没有提醒"这是公开场合"。

**方案**: 评论 prompt 中加 "这是公开的朋友圈，注意分寸，不要透露私密信息"

## 文件变更汇总

| 文件 | 改动 |
|------|------|
| `src/engines/emotion/index.ts` | expressiveness scaling + restraint hint |
| `src/compiler/index.ts` | 关键词扩展 + 动态 defense fragment |
| `src/engines/social/index.ts` | 低互动情绪 + 公共空间意识 |
| `src/adapter/http.ts` | 人类帖子触发 AI 评论 |
| `src/index.ts` | `triggerSocialReactions()` wrapper |
| `tests/emotion.test.ts` | 修复 stale assertions + 2 个 expressiveness 测试 |

## 测试结果

- emotion.test.ts: 27 passed (修复了 3 个 stale 测试 + 新增 2 个)
- compiler.test.ts: 6 passed
- social.test.ts: 24 passed
- 全量: 435 passed, 8 failed (均为 pre-existing)
