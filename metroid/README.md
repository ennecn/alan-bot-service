# Metroid — 自进化 Agent 运行时

Metroid 是一个为 AI 角色扮演设计的运行时引擎，让角色拥有记忆、情感和成长能力。完全兼容 SillyTavern 生态（角色卡 V2 + 世界书），同时提供超越 ST 的高级功能。

## 当前状态

**v0.3.0** — 159 tests passing, 13 test files

| 模块 | 状态 | 说明 |
|------|------|------|
| Memory Engine | ✅ | STM/LTM, 向量+关键词检索, L1 SessionCache, 遗忘曲线, 冲突仲裁 |
| Identity Engine | ✅ | 角色卡加载, 灵魂锚点, 可变特质, 自我意识 |
| World Engine | ✅ | ST 世界书完整兼容 (selective logic, position/depth, probability) |
| Emotion Engine | ✅ | PAD 模型, 规则分析, 风格提示, 惯性+恢复 |
| Growth Engine | ✅ | 行为模式检测, 漂移边界, 审计追踪, Identity 特质同步 |
| Proactive Engine | ✅ | 脉冲累积器, cron/idle/emotion/event 触发, 持久化 |
| Social Engine | ✅ | 关系管理, 亲密度追踪, prompt 注入 |
| Session Engine | ✅ | 跨会话记忆连续性, 自动加载上次对话上下文 |
| Feed Engine | ✅ | Agent 视角动态 (心情/记忆回响/里程碑/思考) |
| Conversation Engine | ✅ | 多 Agent 对话, 轮次调度, 共享历史 |
| Prompt Compiler | ✅ | 双模式组装, CJK token 估算, KV-cache 优化排序 |
| HTTP Adapter | ✅ | REST + WebSocket, Bearer 认证, 限流, 输入验证 |
| CLI v0.2 | ✅ | 10 个命令, 状态行 |

## 双模式架构

一套引擎，两种编译模式，一键切换：

- **Classic 模式**: 完全兼容 SillyTavern，position/depth 排序，只用 Identity + World 引擎
- **Enhanced 模式**: 全引擎激活 (Memory + Emotion + Growth)，priority 排序，角色会记忆、有情绪、会成长

```
切换: POST /agents/:id/mode {"mode":"enhanced"}
CLI:  /mode enhanced
```

## 快速开始

```bash
cd metroid
npm install

# 运行测试
npm test

# CLI 聊天 (需要 API key)
ANTHROPIC_API_KEY=xxx npm run chat -- cards/rachel.json

# 启动 HTTP 服务 (供 bot 调用)
ANTHROPIC_API_KEY=xxx npm run serve
```

## HTTP Adapter API

默认端口 `8100`，可通过 `--port` 参数修改。

### 健康检查

```bash
curl http://127.0.0.1:8100/health
# {"status":"ok","agents":2,"uptime":123.4}
```

### Agent 管理

```bash
# 列出所有 agent
curl http://127.0.0.1:8100/agents

# 获取 agent 详情
curl http://127.0.0.1:8100/agents/AGENT_ID

# 创建 agent
curl http://127.0.0.1:8100/agents \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Rachel",
    "card": { "name": "Rachel", "description": "...", "personality": "..." },
    "mode": "enhanced"
  }'

# 切换模式
curl http://127.0.0.1:8100/agents/AGENT_ID/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"enhanced"}'
```

### 对话

```bash
curl http://127.0.0.1:8100/agents/AGENT_ID/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "你好！最近怎么样？",
    "userId": "alin",
    "userName": "阿凛",
    "history": [
      {"content": "上次我们聊了原神", "isBot": false},
      {"content": "是的，你提到了蒙德城", "isBot": true}
    ]
  }'
```

返回：
```json
{
  "response": "嗯...最近还好啦...",
  "emotion": { "pleasure": 0.2, "arousal": 0.1, "dominance": -0.1 },
  "mode": "enhanced",
  "growthChanges": 2
}
```

参数说明：
| 字段 | 必填 | 说明 |
|------|------|------|
| content | ✅ | 用户消息内容 |
| userId | ❌ | 用户 ID (默认 "user-api") |
| userName | ❌ | 用户名 (默认 "用户") |
| channel | ❌ | 渠道 (默认 "web-im") |
| history | ❌ | 对话历史数组, 每条 `{content, isBot}` |

### 情绪状态

```bash
curl http://127.0.0.1:8100/agents/AGENT_ID/emotion
# {"emotion":{"pleasure":0.2,"arousal":0.1,"dominance":-0.1}}
```

PAD 模型三轴：
- **Pleasure** (-1~+1): 愉悦度。正面互动提升，负面互动降低
- **Arousal** (-1~+1): 激活度。感叹号、紧急词提升
- **Dominance** (-1~+1): 支配度。命令式提升，不确定语气降低

情绪会影响回复风格（通过间接提示，不是直接标签），并随时间向基线恢复。

### 记忆

```bash
curl 'http://127.0.0.1:8100/agents/AGENT_ID/memories?limit=5'
```

返回最近的记忆，包含类型 (episodic/semantic/stm)、内容摘要、重要度、置信度。

### 成长

```bash
curl http://127.0.0.1:8100/agents/AGENT_ID/growth
```

返回活跃的行为变化，例如：
```json
{
  "changes": [
    {
      "observation": "用户在最近10条消息中纠正了3次",
      "adaptation": "更注意用户的澄清，仔细理解用户的意图后再回复",
      "confidence": 0.85
    }
  ]
}
```

### 社交关系

```bash
# 获取 agent 的关系列表
curl http://127.0.0.1:8100/agents/AGENT_ID/relationships

# 添加/更新关系
curl http://127.0.0.1:8100/agents/AGENT_ID/relationships \
  -H 'Content-Type: application/json' \
  -d '{"targetAgentId":"OTHER_ID","type":"friend","affinity":0.7}'
```

### 会话管理

```bash
# 开始新会话 (自动加载上次对话上下文)
curl http://127.0.0.1:8100/agents/AGENT_ID/sessions \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-1","contextTail":5}'

# 列出会话
curl 'http://127.0.0.1:8100/agents/AGENT_ID/sessions?limit=10'

# 结束会话
curl -X POST http://127.0.0.1:8100/sessions/SESSION_ID/end

# 获取会话消息
curl 'http://127.0.0.1:8100/sessions/SESSION_ID/messages?limit=50'
```

聊天时传入 `sessionId` 可自动记录消息到会话：
```bash
curl http://127.0.0.1:8100/agents/AGENT_ID/chat \
  -H 'Content-Type: application/json' \
  -d '{"content":"你好","sessionId":"SESSION_ID"}'
```

### Agent 动态 (Feed)

```bash
# 获取 agent 动态
curl 'http://127.0.0.1:8100/agents/AGENT_ID/feed?limit=20'

# 手动触发动态生成
curl -X POST http://127.0.0.1:8100/agents/AGENT_ID/feed/generate
```

动态类型: `thought` (思考), `memory_echo` (记忆回响), `mood` (心情), `milestone` (里程碑), `reflection` (反思)

### 多 Agent 对话

```bash
# 创建对话
curl http://127.0.0.1:8100/conversations \
  -H 'Content-Type: application/json' \
  -d '{"agentIds":["AGENT_A","AGENT_B"],"topic":"讨论今天的天气"}'

# 列出对话
curl http://127.0.0.1:8100/conversations

# 发送消息 (自动调度下一个发言者)
curl http://127.0.0.1:8100/conversations/CONV_ID/message \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"AGENT_A","content":"今天天气真好"}'

# 获取对话消息
curl 'http://127.0.0.1:8100/conversations/CONV_ID/messages?limit=50'
```

### 世界书搜索

```bash
curl 'http://127.0.0.1:8100/world/search?q=Mondstadt'
```

### 导入世界书

```bash
curl http://127.0.0.1:8100/import/world \
  -H 'Content-Type: application/json' \
  -d '{"path":"/path/to/genshin-world.json","charName":"Rachel"}'
```

### Prompt 检查器

```bash
# 查看编译后的完整 prompt (调试用)
curl 'http://127.0.0.1:8100/agents/AGENT_ID/prompt-inspect?userId=user-1'
```

### 配置

```bash
# 获取 agent 运行时配置
curl http://127.0.0.1:8100/agents/AGENT_ID/config

# 更新配置
curl http://127.0.0.1:8100/agents/AGENT_ID/config \
  -H 'Content-Type: application/json' \
  -d '{"memory":{"maxRetrieved":8}}'
```

## OpenClaw Bot 集成示例

在 bot 的 skill 或 exec tool 中调用：

```javascript
// 发送消息并获取回复
const res = await fetch('http://127.0.0.1:8100/agents/AGENT_ID/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    content: userMessage,
    userId: telegramUserId,
    userName: telegramUserName,
    history: recentMessages,
  }),
});
const { response, emotion, growthChanges } = await res.json();

// 根据情绪调整行为
if (emotion.pleasure < -0.3) {
  // 角色心情不好，可以调整 TTS 语调
}
```

## CLI 命令

```
/help                    显示所有命令
/mode [classic|enhanced] 切换/查看模式
/emotion                 显示 PAD 情绪状态 (带进度条)
/memories [limit]        显示最近记忆
/growth                  显示活跃的行为变化
/agents                  列出所有 agent
/world [keyword]         搜索世界书条目
/import <file>           导入 ST 角色卡(.png/.json)或世界书
/debug                   切换调试模式
/quit                    退出
```

Enhanced 模式下每次回复后显示状态行：
```
[enhanced | P:+0.30 A:+0.10 D:+0.40 | 记忆:12 | 成长:3]
```

## 项目结构

```
metroid/
├── src/
│   ├── index.ts              # 主类 Metroid (编排所有引擎)
│   ├── types.ts              # 核心类型定义
│   ├── config.ts             # 配置
│   ├── cli.ts                # CLI v0.2
│   ├── adapter/
│   │   └── http.ts           # HTTP REST + WebSocket API
│   ├── compiler/
│   │   └── index.ts          # 双模式 Prompt Compiler
│   ├── db/
│   │   ├── index.ts          # SQLite 连接管理 + 迁移
│   │   └── schema.sql        # 数据库 Schema
│   ├── engines/
│   │   ├── identity/         # 身份引擎 (角色卡, 灵魂锚点, 可变特质, 自我意识)
│   │   ├── memory/           # 记忆引擎
│   │   │   ├── store.ts      #   存储层 (STM/LTM)
│   │   │   ├── retriever.ts  #   检索 (向量+关键词+隐私过滤)
│   │   │   ├── encoder.ts    #   编码 (LLM 摘要)
│   │   │   ├── forgetter.ts  #   遗忘曲线 (多 agent)
│   │   │   ├── session-cache.ts # L1 会话缓存
│   │   │   ├── conflict.ts   #   冲突仲裁
│   │   │   ├── snapshot.ts   #   快照导出/导入
│   │   │   ├── embedding.ts  #   向量嵌入
│   │   │   └── graph-rag.ts  #   GraphRAG 关系图
│   │   ├── world/            # 世界引擎 (ST 世界书兼容)
│   │   ├── emotion/          # 情绪引擎 (PAD 模型)
│   │   ├── growth/           # 成长引擎 (行为漂移 + Identity 同步)
│   │   ├── proactive/        # 主动引擎 (脉冲累积, cron/idle/emotion 触发)
│   │   ├── social/           # 社交引擎 (关系管理, 亲密度)
│   │   ├── session/          # 会话引擎 (跨会话连续性)
│   │   ├── feed/             # 动态引擎 (Agent 视角帖子)
│   │   └── conversation/     # 对话引擎 (多 Agent 对话)
│   ├── importers/
│   │   ├── st-card.ts        # ST 角色卡 V2 导入 (PNG/JSON)
│   │   ├── st-world.ts       # ST 世界书导入
│   │   └── png-parser.ts     # PNG tEXt chunk 解析
│   └── security/
│       └── audit.ts          # 审计日志
├── tests/                    # 159 tests, 13 files
├── tests/perf/               # 性能基准测试 (7 benchmarks)
├── data/                     # SQLite DB + 运行时数据
└── ARCHITECTURE.md           # 架构设计文档
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| ANTHROPIC_API_KEY | ✅ | LLM API key |
| ANTHROPIC_BASE_URL | ❌ | 自定义 API 地址 |
| OPENAI_BASE_URL | ❌ | OpenAI 兼容 API (用于 embedding) |
| METROID_MODEL | ❌ | 主模型 (默认 claude-opus-4-6) |
| METROID_LIGHT_MODEL | ❌ | 轻量模型 (默认 claude-haiku-4-5) |
| METROID_DATA_DIR | ❌ | 数据目录 (默认 ./data) |
| METROID_API_TOKEN | ❌ | API Bearer token 认证 (不设则无认证) |

## 安全

设置 `METROID_API_TOKEN` 后，所有请求需携带 Bearer token：

```bash
curl http://127.0.0.1:8100/agents \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

`/health` 端点不需要认证。请求体限制 1MB，mutation 端点限流 60/min，read 端点 600/min。
