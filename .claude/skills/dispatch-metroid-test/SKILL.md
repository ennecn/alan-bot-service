---
name: dispatch-metroid-test
description: 调度 bot 运行 Metroid 分布式测试。仅当用户明确要求 bot 参与时触发：'让阿凛她们测试'、'让bot测试'、'bot一起跑'、'调度bot'、'dispatch bots'。普通的'跑测试'、'测试模型'等不触发此 skill，由我自己执行。
---

# Metroid 分布式测试调度 v2

## 核心原则

1. **仅在用户明确提到 bot 时才调度** — "让阿凛她们测试"、"让bot跑" → 调度；"跑个测试"、"测试下这个模型" → 自己跑
2. **职责分离** — Bot 只采集数据（不 judge），我统一做 pairwise judge
3. **我写测试脚本** — Bot 只执行 `python run_test.py`，不自己设计测试
4. **Preflight 先行** — 正式测试前验证环境
5. **Pairwise comparison** — 不打绝对分，让 judge 对比 classic vs enhanced 选择哪个更好

## 7 步流程

```
1. 沟通测试需求 → 确定场景、卡、模型
2. 我写测试脚本 → run_test.py + scenario JSON
3. Preflight → 验证 bot 环境（API key、Server、deps）
4. 分配任务 → scp 脚本到 bot workdir，dispatch 执行
5. Bot 返回 JSON → 配对的 classic/enhanced 对话数据（不含 judge）
6. 我做 pairwise judge → judge_pairwise.py 统一评审
7. 生成 HTML 报告 → generate_report.py
```

## 脚本位置

Mac Mini: `/Users/fangjin/metroid/tests/distributed/`
```
├── run_test.py              # Bot 执行的测试脚本
├── preflight.py             # 环境检查
├── judge_pairwise.py        # Pairwise judge（我执行）
├── generate_report.py       # HTML 报告生成（我执行）
├── scenarios/
│   └── emotion-probe.json   # 预定义消息的场景文件
└── results/                 # 测试结果输出目录
```

本地源码: `D:\openclawVPS\metroid\tests\distributed\`

## Step 1: 准备角色卡

如果用户提供了新角色卡（PNG 或 JSON）：

```bash
# 从 PNG 提取（SillyTavern 格式）
python -c "
import struct, base64, json, sys
with open(sys.argv[1], 'rb') as f:
    f.read(8)
    while True:
        raw = f.read(8)
        if len(raw) < 8: break
        length, chunk_type = struct.unpack('>I4s', raw)
        data = f.read(length); f.read(4)
        if chunk_type == b'tEXt':
            parts = data.split(b'\x00', 1)
            if len(parts) == 2 and parts[0] == b'chara':
                card = json.loads(base64.b64decode(parts[1]))
                json.dump(card, open(sys.argv[2],'w',encoding='utf-8'), ensure_ascii=False, indent=2)
                print('OK'); break
" INPUT.png OUTPUT-extracted.json

# 上传到 Mac Mini
scp cards/CARD.json fangjin@192.168.21.111:/Users/fangjin/metroid/cards/
```

## Step 2: 确保 Test Server 运行

```bash
python ssh_macmini.py "curl -s http://127.0.0.1:8100/health"
```

如果没运行：
```bash
python ssh_macmini.py "tmux new-session -d -s metroid-test 'bash ~/metroid/start-test-server.sh'"
```

## Step 3: 写场景文件（如需新场景）

场景 JSON 格式（预定义用户消息，确保 classic/enhanced 收到相同输入）：
```json
{
  "name": "scenario-name",
  "description": "场景描述",
  "dimensions": ["dim1", "dim2"],
  "phases": [
    {
      "name": "phase-name",
      "description": "阶段描述",
      "messages": ["用户消息1", "用户消息2"]
    }
  ]
}
```

已有场景：
- `scenarios/emotion-probe.json` — 4 阶段 15 轮情绪探测

部署新场景：
```bash
scp scenarios/NEW.json fangjin@192.168.21.111:/Users/fangjin/metroid/tests/distributed/scenarios/
```

## Step 4: Preflight 检查

```bash
python ssh_macmini.py -f /tmp/preflight.sh
```

preflight.sh 内容：
```bash
cd /Users/fangjin/metroid/tests/distributed
python3 preflight.py \
  --server http://127.0.0.1:8100 \
  --api-key API_KEY \
  --scenario scenarios/SCENARIO.json
```

必须 5/5 通过才能继续。

## Step 5: 分配任务给 Bot

### 方法 A: 直接在 Mac Mini 执行（单机并行）

```bash
# 每张卡一个进程，后台并行
python ssh_macmini.py -f /tmp/run-tests.sh
```

run-tests.sh 内容：
```bash
cd /Users/fangjin/metroid/tests/distributed
python3 run_test.py \
  --server http://127.0.0.1:8100 \
  --card CARD_NAME \
  --scenario scenarios/SCENARIO.json \
  --api-key API_KEY \
  --output results/CARD-SCENARIO.json
```

### 方法 B: 通过 Claude Code Dispatch 分配给 Bot

```bash
# 1. 写 bot 任务 prompt
cat > /tmp/bot-task.txt << 'EOF'
执行以下命令：
cd /Users/fangjin/metroid/tests/distributed
python3 run_test.py --server http://127.0.0.1:8100 --card CARD --scenario scenarios/SCENARIO.json --api-key API_KEY --output results/CARD-SCENARIO.json
完成后报告结果文件大小。
EOF

# 2. Dispatch
python ssh_macmini.py "bash /Users/fangjin/claude-code-dispatch.sh \
  -p /tmp/bot-task.txt \
  -w /Users/fangjin/metroid/tests/distributed \
  -t 50 -n task-name -m bypassPermissions"
```

Bot 容器端口映射（dispatch 用）：
- 阿凛: deploy-openclaw-gateway-1, port 18789
- 阿澪: aling-gateway, port 18791
- Lain: lain-gateway, port 18790
- Lumi: lumi-gateway, port 18792

## Step 6: 收集数据 + Pairwise Judge

Bot 完成后，结果在 `results/CARD-SCENARIO.json`。

我统一做 pairwise judge：
```bash
python ssh_macmini.py -f /tmp/judge.sh
```

judge.sh 内容：
```bash
cd /Users/fangjin/metroid/tests/distributed
python3 judge_pairwise.py \
  --input results/CARD-SCENARIO.json \
  --api-key API_KEY \
  --judge-model "Qwen/Qwen3-235B-A22B-Instruct-2507" \
  --output results/CARD-SCENARIO-judged.json
```

## Step 7: 生成 HTML 报告

```bash
# 在 Mac Mini 生成
python ssh_macmini.py -f /tmp/report.sh

# report.sh:
cd /Users/fangjin/metroid/tests/distributed
python3 generate_report.py \
  --input results/CARD-SCENARIO-judged.json \
  --output results/report-CARD-SCENARIO.html

# 下载到本地
scp fangjin@192.168.21.111:/Users/fangjin/metroid/tests/distributed/results/report-*.html D:/openclawVPS/logs/
```

## Pairwise Judge 原理

不打绝对分（避免"全部10/10"问题），而是：
1. 给 judge 同时看 classic (A) 和 enhanced (B) 的回复
2. 对每个维度问"哪个更好，为什么"
3. 要求给出 winner (A/B/tie)、margin (large/small/negligible)、reason
4. 汇总各维度的胜负统计

## 已知 API Key

- SiliconFlow: `sk-qylxcddwteqbqdmptzhtxhqlgyhmcgwlszaybqibwcpeatsd`
- 测试模型: `Qwen/Qwen3-Next-80B-A3B-Instruct`
- Judge 模型: `Qwen/Qwen3-235B-A22B-Instruct-2507`

## Test Server API 速查

| 端点 | 说明 |
|------|------|
| `GET /health` | 服务器状态 |
| `POST /agents` | 创建 agent `{name, card, mode}` |
| `POST /agents/:id/chat` | 发消息 `{content, userId, userName}` |
| `POST /agents/:id/config` | 注入 LLM 配置 `{openaiApiKey, openaiModel, openaiBaseUrl}` |
| `GET /agents/:id/emotion` | 获取情绪状态 |
| `GET /agents/:id/memories` | 获取记忆 |
| `GET /agents/:id/growth` | 获取成长变化 |

Chat 响应包含: `response, emotion{pleasure,arousal,dominance}, growthChanges, timing, voiceHint`

## 常见问题

### SiliconFlow 限流 (429 TPM)
- run_test.py 内置 retry + 30s 等待
- 多 bot 并行时用不同 API key 避免限流

### 服务器 placeholder key
- run_test.py 通过 `/agents/:id/config` 注入真实 API key
- 全局生效，只需设置一次

### 角色卡 JSON 解析错误
- 必须用 Python json.dump 生成 JSON，不要用 Write 工具直接写
