---
name: compare-test
description: ST vs Metroid 端到端回复质量对比测试。触发词：'compare-test'、'对比测试ST'、'ST vs Metroid'、'跑对比'。执行完整的数据采集 + Judge 评判流程。
---

# ST vs Metroid 对比测试 Skill

## 概述

同一 LLM、同一角色卡，唯一变量是 prompt 组装方式（SillyTavern vs Metroid）。
分两阶段：数据采集（JSON）→ Judge 评判（MD + HTML）。

## 参数解析

从用户的自然语言指令中提取以下参数，未指定则用默认值：

| 参数 | CLI flag | 默认值 | 说明 |
|------|----------|--------|------|
| 角色卡 | `--card` | steinsgate | Metroid cards/ 下的角色卡名 |
| ST角色 | `--st-char` | 自动匹配 | ST 中的角色 avatar 文件名 |
| LLM模型 | `--model` | Qwen/Qwen3-30B-A3B-Instruct-2507 | 被测 LLM |
| LLM地址 | `--model-url` | https://api.siliconflow.cn/v1 | LLM API 地址 |
| LLM密钥 | `--model-key` | sk-qylxcddwteqbqdmptzhtxhqlgyhmcgwlszaybqibwcpeatsd | LLM API key |
| Judge模型 | `--judge-models` | claude-sonnet-4-6,gemini-3-flash-preview-nothinking | 逗号分隔 |
| Judge地址 | `--judge-url` | https://ai.t8star.cn/v1 | Judge API 地址 |
| Judge密钥 | `--judge-key` | sk-vpY3fxUptUJ5eV82mDCRfIDDJH3weGm3E37spwQbEO94r1pY | Judge API key |
| Metroid模式 | `--metroid-mode` | enhanced | enhanced / classic |
| 消息文件 | `--messages-file` | 内置默认 | 自定义测试消息 JSON |
| 轮次 | `--rounds` | 全部 | 逗号分隔的轮次 ID |
| 新Agent | `--fresh-agent` | 默认开启 | 每次创建新 agent |
| 跳过Judge | `--skip-judge` | false | 只采集数据 |
| 仅Judge | `--judge-only` | - | 对已有 JSON 补跑 judge |

## 执行流程

### Phase 0: 环境检查

1. 检查 SillyTavern 是否在线：
```bash
curl -s http://127.0.0.1:8000/api/ping 2>/dev/null || echo "ST offline"
```

2. 检查 Metroid test server 是否在线：
```bash
curl -s http://127.0.0.1:8100/health 2>/dev/null || echo "Metroid offline"
```

如果 ST 离线：
```bash
# 启动 SillyTavern（在 sillytavern launcher 目录）
cd D:/sillytavern/SillyTavern-Launcher/SillyTavern && node server.js &
```

如果 Metroid 离线，提示用户手动启动（需要指定 LLM 环境变量）：
```
请在 Mac Mini 上启动 Metroid test server:
tmux new-session -d -s metroid-test 'bash ~/metroid/start-test-server.sh'
```

### Phase 1: 数据采集

构建并执行命令：
```bash
cd D:/openclawVPS/sillytavern_test && python st_vs_metroid_compare.py \
  --card {card} \
  --model "{model}" \
  --model-url "{model_url}" \
  --model-key "{model_key}" \
  --metroid-mode {metroid_mode} \
  --fresh-agent \
  --skip-judge \
  {--rounds X,Y if specified} \
  {--st-char "avatar.png" if specified} \
  {--messages-file path if specified}
```

输出：`sillytavern_test/results/st-vs-metroid-{timestamp}.json`

检查输出文件是否生成且非空。如果有 error 轮次，报告给用户但继续。

### Phase 2: Judge 评判

对 Phase 1 的 JSON 结果跑 judge：
```bash
cd D:/openclawVPS/sillytavern_test && python st_vs_metroid_compare.py \
  --judge-only "results/{json_file}" \
  --judge-models "{judge_models}" \
  --judge-url "{judge_url}" \
  --judge-key "{judge_key}"
```

每个 judge 模型各生成：
- `results/st-vs-metroid-judge-{model}-{timestamp}.md`
- `results/st-vs-metroid-judge-{model}-{timestamp}.html`

### Phase 3: 汇报结果

1. 读取生成的 MD 报告，向用户展示关键结论
2. 列出所有生成的文件路径
3. 如果有多个 judge，对比各 judge 的结论是否一致

## 自定义消息文件格式

```json
[
  {"id": 1, "scene": "场景名", "message": "用户消息"},
  {"id": 2, "scene": "场景名", "message": "用户消息"}
]
```

## 示例用法

- `/compare-test` — 默认参数全量测试
- `/compare-test --card rachel --model deepseek-v3` — 换角色卡和模型
- `/compare-test --judge-only results/st-vs-metroid-20260225.json` — 对已有数据补跑 judge
- `/compare-test --skip-judge --rounds 1,2,3` — 只采集前3轮数据
- `/compare-test --judge-models claude-sonnet-4-6` — 只用一个 judge
