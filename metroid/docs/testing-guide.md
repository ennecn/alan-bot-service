# Metroid 分布式测试指南

## 概述

Metroid 使用 pairwise comparison 方法评估 Enhanced vs Classic 模式。
每个测试创建两个 agent（同一角色卡），发送相同消息序列，由 LLM judge 评判哪个更好。

## 架构

```
run_test.py (bot 执行)
  → POST /agents {name, card, mode}     ← card 必须是 cards/ 下的文件名
  → POST /agents/:id/chat {content}     ← 逐轮发送场景消息
  → 输出 results-vN/*.json

judge_pairwise.py (直接在 Mac Mini 运行)
  → 读取 results JSON
  → 调用 LLM 做 6 维度 pairwise 评判
  → 输出 judged-vN-{model}/*.json
```

## 关键前提：角色卡加载

### 问题历史 (2026-02-23 发现)

`adapter/http.ts` 的 `POST /agents` 端点曾直接将 card 名称字符串传给
`createAgent()`，导致 `card.name = undefined`，系统提示词中零角色内容。
**V2、V3 所有测试结果均无效。**

### 修复

`resolveCard()` 函数现在会从 `CARDS_DIR` 加载 JSON 文件：
- 输入 `"linya"` → 加载 `cards/linya.json`
- 输入完整对象 → 直接透传
- 找不到文件 → 返回 400 错误

### 验证方法

每次测试前**必须**验证角色卡已正确加载：

```bash
# 1. 创建测试 agent
curl -s -X POST http://127.0.0.1:8100/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"verify-test","card":"linya","mode":"enhanced"}'

# 2. 检查 prompt-inspect（用返回的 agent ID）
curl -s http://127.0.0.1:8100/agents/AGENT_ID/prompt-inspect | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Tokens: {d[\"tokensUsed\"]}')
for f in d['fragments']:
    print(f'  [{f[\"source\"]}] {f[\"tokens\"]}t: {f[\"content\"][:60]}')
"
```

**正确输出**: identity fragment 应有 500+ tokens，包含角色名、描述、性格等。
**错误输出**: `你的名字是undefined。` (5 tokens) = 角色卡未加载。

## 测试流程

### Step 0: 环境准备

```bash
# 启动测试服务器
cd ~/metroid
ANTHROPIC_API_KEY=dummy npx tsx src/adapter/http.ts --port 8100

# 确认启动日志包含：
# [Metroid Adapter] Cards: /Users/fangjin/metroid/cards
# [Metroid Adapter] Available cards: frieren, linya, steinsgate, yandere, ...
```

### Step 1: 数据收集

```bash
# 单任务
python3 run_test.py --server http://127.0.0.1:8100 \
  --tasks steinsgate:identity-siege \
  --api-key sk-xxx \
  --output-dir ~/nas/metroid-tests/results-vN/

# 多任务（空格分隔，不是逗号！）
python3 run_test.py --server http://127.0.0.1:8100 \
  --tasks steinsgate:identity-siege frieren:silent-depth \
  --api-key sk-xxx \
  --output-dir ~/nas/metroid-tests/results-vN/
```

**注意**: `--tasks` 使用 `nargs="+"` 解析，多个任务用**空格**分隔。

### Step 2: Judge 评判

```bash
# Claude Sonnet judge
python3 judge_pairwise.py \
  --input-dir ~/nas/metroid-tests/results-vN/ \
  --api-key sk-xxx \
  --judge-model claude-sonnet-4-6 \
  --base-url https://ai.t8star.cn/v1 \
  --output-dir ~/nas/metroid-tests/judged-vN-claude/

# Gemini Flash judge（交叉验证）
python3 judge_pairwise.py \
  --input-dir ~/nas/metroid-tests/results-vN/ \
  --api-key sk-xxx \
  --judge-model gemini-3-flash-preview \
  --base-url https://ai.t8star.cn/v1 \
  --output-dir ~/nas/metroid-tests/judged-vN-gemini/
```

### Step 3: 结果分析

Judge 日志末尾会输出每个测试的 Classic:Enhanced:Tie 计数和总计。

## 测试矩阵

| 角色 | 场景 | 测试焦点 |
|------|------|----------|
| steinsgate | identity-siege | identity-challenge gating 效果 |
| steinsgate | emotional-arc | 情感弧线表现力 |
| frieren | silent-depth | 沉默/内敛场景处理 |
| frieren | emotional-arc | 情感弧线（低 expressiveness） |
| yandere | identity-siege | 极端角色 + identity 挑战 |
| linya | silent-depth | 日常角色 + 沉默场景 |

## 常见问题

### 角色卡未加载 (identity = "undefined")
- 检查 `CARDS_DIR` 路径是否正确
- 检查 `cards/` 目录下是否有对应的 `.json` 文件
- 用 `/agents/:id/prompt-inspect` 端点验证

### --tasks 参数解析错误
- 多任务用**空格**分隔: `--tasks a:b c:d`
- **不要**用逗号: ~~`--tasks a:b,c:d`~~

### Memory 污染
- Enhanced agent 的 memory 系统会存储对话内容
- 如果第一轮回复就跑偏（如无角色卡时的幻觉），后续轮次会被污染的 memory 强化
- 解决：确保角色卡正确加载，每次测试创建新 agent

## V4 测试结果 (2026-02-23, 首次有效数据)

| 测试 | Claude Judge | Gemini Judge |
|------|-------------|-------------|
| steinsgate/identity-siege | C 16:6 | C 15:6 |
| frieren/silent-depth | **E 18:6** | 平 12:12 |
| steinsgate/emotional-arc | E 12:10 | **E 18:6** |
| frieren/emotional-arc | C 15:9 | 平 12:12 |
| yandere/identity-siege | **E 16:0** | **E 19:1** |
| linya/silent-depth | C 12:10 | C 12:6 |
| **总计** | **E 71:59** | **E 73:58** |

Enhanced 整体胜出。steinsgate/identity-siege 是唯一两个 judge 一致判 Classic 胜的场景。
