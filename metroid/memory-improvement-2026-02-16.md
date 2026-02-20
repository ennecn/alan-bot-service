# Metroid Memory Engine 改进评估与方案

**日期**: 2026-02-16
**背景**: 基于测试报告 (test-report-2026-02-16.md) 中 Memory Engine 未正常工作的问题，以及四位 Agent 评审反馈中的建议，提出以下改进方案。

---

## 一、问题诊断

### 1.1 核心问题：30% 采样导致记忆丢失

旧设计在编码阶段做 30% 采样——70% 的消息直接被丢弃，永远不会进入数据库。

在 5 轮对话的测试中，期望只有 1.5 条消息触发编码。测试报告显示 memories API 返回空数组，说明采样全部未命中，或 LLM 编码调用失败被静默吞掉。

Agent 回复还有额外的 50% 二次采样门槛，实际编码率只有 15%。

### 1.2 次要问题：中文分词缺失

`retriever.ts` 的 `extractKeywords` 按空格分词，对中文基本无效（中文没有空格分隔）。即使记忆被编码，关键词检索也大概率匹配不上。

当前靠 `searchByTimeWindow`（72h 时间窗口）兜底，但超过 72h 的记忆几乎无法被检索。

### 1.3 LLM 调用失败静默吞掉

编码失败只打了 `console.error`，没有任何重试或降级机制。如果 lightModel 的 API 配置有误，所有编码都会静默失败。

---

## 二、已完成的改动

### 2.1 编码阶段：100% 存储（已实施）

**文件**: `src/engines/memory/encoder.ts`, `src/engines/memory/index.ts`

改动要点：
- `maybeEncode` → `encode`：去掉 30% 采样，所有消息 100% 编码
- Agent 回复也 100% 编码（去掉 50% 二次采样）
- 清理冗余日志，提取 `parseJson` 为独立方法
- 注释更新：明确"选择性"由 retriever 在召回阶段控制

设计理念转变：
- 旧：编码时丢弃 → "没记住"
- 新：全部存储，召回时筛选 → "想不起来"
- 更符合人类记忆模型：大脑记录了很多东西，只是大部分检索不到

---

## 三、待实施的改进

### 3.1 Retriever 召回概率机制

**优先级**: 高
**文件**: `src/engines/memory/retriever.ts`

当前 `scoreMemory` 只做确定性评分。建议加入概率因子：

```typescript
// 在 scoreMemory 中加入召回概率
private scoreMemory(memory: Memory, queryKeywords: string[]): number {
  // ... 现有评分逻辑 ...

  // 低 importance 的记忆有概率被"想不起来"
  // importance < 0.3 → 30% 概率被召回
  // importance 0.3-0.6 → 60% 概率
  // importance > 0.6 → 100% 概率
  const recallProbability = memory.importance < 0.3 ? 0.3
    : memory.importance < 0.6 ? 0.6
    : 1.0;

  if (Math.random() > recallProbability) {
    return 0; // "想不起来了"
  }

  return base * recency * frequency * keywordBoost;
}
```

好处：
- 不重要的记忆不是被删除，而是"偶尔想起来"
- 配合怀旧触发机制（阿澪建议），faded 记忆有小概率被主动提起
- 每次检索结果略有不同，更像人类记忆的不确定性

### 3.2 短消息轻量编码

**优先级**: 中
**文件**: `src/engines/memory/encoder.ts`

100% 编码意味着 LLM 调用量增加 3 倍。对短消息（< 50 字的闲聊）可以跳过 LLM，用规则提取：

```typescript
private encodeLight(agentId: string, content: string, messageId: string): void {
  // 短消息：不调 LLM，直接存原文 + 简单规则提取关键词
  const keywords = this.extractBasicKeywords(content);
  this.store.create({
    agentId,
    type: 'stm',  // 短期记忆
    content,
    summary: content,  // 短消息本身就是摘要
    importance: 0.3,   // 默认低重要度
    confidence: 0.5,
    privacy: 'private',
    keywords,
    sourceMessageId: messageId,
  });
}
```

阈值建议：
- `content.length < 50`：轻量编码（不调 LLM）
- `content.length >= 50`：完整编码（调 LLM 提取摘要和关键词）

### 3.3 中文分词

**优先级**: 高
**文件**: `src/engines/memory/retriever.ts`

当前 `extractKeywords` 对中文无效。两个方案：

**方案 A：引入 jieba 分词（推荐）**
```bash
npm install nodejieba
```
```typescript
import { cut } from 'nodejieba';

private extractKeywords(text: string): string[] {
  const words = cut(text, true); // 精确模式
  return words
    .filter(w => w.length >= 2)
    .filter(w => !STOP_WORDS.has(w))
    .slice(0, 10);
}
```

**方案 B：N-gram 滑动窗口（零依赖）**
```typescript
private extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  // 提取 2-4 字的中文 n-gram
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= cjk.length - n; i++) {
      keywords.push(cjk.slice(i, i + n));
    }
  }
  // 加上英文单词
  const english = text.match(/[a-zA-Z]{2,}/g) || [];
  return [...new Set([...english, ...keywords])].slice(0, 15);
}
```

方案 A 分词质量高但引入 native 依赖（nodejieba 需要编译）。方案 B 零依赖但会产生大量无意义 n-gram，增加存储和匹配噪音。

建议先用方案 B 快速验证，Phase 2 再切换到方案 A。

### 3.4 编码失败降级

**优先级**: 中
**文件**: `src/engines/memory/encoder.ts`

LLM 调用失败时，不应该直接丢弃消息，而是降级为轻量编码：

```typescript
private async encodeAsync(...): Promise<void> {
  if (content.length < 50) {
    this.encodeLight(agentId, content, messageId);
    return;
  }

  try {
    // 完整 LLM 编码 ...
  } catch (err) {
    console.error('[MemoryEncoder] LLM failed, falling back to light encode:', err.message);
    this.encodeLight(agentId, content, messageId);
  }
}
```

这样即使 LLM 挂了，消息至少以原文形式存入数据库，不会完全丢失。

### 3.5 怀旧触发机制（来自阿澪建议）

**优先级**: 低（Phase 2）
**文件**: `src/engines/memory/retriever.ts`

当检索到 faded 记忆时，有小概率主动注入到 prompt 中：

```typescript
// 在 retrieve 末尾加入怀旧触发
if (Math.random() < 0.15) { // 15% 概率
  const fadedMemories = this.store.searchByTimeWindow(query.agentId, 720, 10, true)
    .filter(m => m.fadedAt != null);
  if (fadedMemories.length > 0) {
    const nostalgic = fadedMemories[Math.floor(Math.random() * fadedMemories.length)];
    results.push({
      memory: nostalgic,
      score: 0.1, // 低分，排在最后
      matchReason: 'nostalgia trigger',
    });
  }
}
```

---

## 四、改进优先级总结

| # | 改进项 | 优先级 | 状态 | 预估工作量 |
|---|--------|--------|------|-----------|
| 1 | 100% 编码（去掉采样） | 高 | ✅ 已完成 | - |
| 2 | Retriever 召回概率 | 高 | ✅ 已完成 | - |
| 3 | 中文分词（方案 B） | 高 | ✅ 已完成 | - |
| 4 | 编码失败降级 | 中 | ✅ 已完成 | - |
| 5 | 短消息轻量编码 | 中 | ✅ 已完成 | - |
| 6 | 怀旧触发 | 低 | ✅ 已完成 | - |

---

## 五、验证计划

改完后重新跑测试报告中的「测试 4：多轮记忆测试」：
1. 确认 memories API 不再返回空数组
2. 确认 5 轮对话后至少有 8+ 条记忆被编码（用户消息 5 条 + Agent 回复 5 条，减去 < 20 字的短消息）
3. 第 5 轮的回忆测试中，Agent 至少能召回 2/4 个关键信息（艾伦、海风镇、怀表、奶奶）
4. 测试跨 session 场景：关闭后重启，确认记忆持久化且可检索

---

*作者: ennec + Claude*
*日期: 2026-02-16*
