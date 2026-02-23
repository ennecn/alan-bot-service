# Metroid Distributed Test — Worker API Reference

Bot workers 通过 HTTP API 与 Metroid Test Server 交互，通过 NAS 上的 `board.json` 协调状态。

## Server URL

从 `board.json` 的 `server` 字段获取，通常为 `http://192.168.21.111:8100`。

---

## Preflight Checks (F1 赛前检查)

开始测试前，worker 必须通过以下检查：

| 检查项 | 方法 | 失败处理 |
|--------|------|----------|
| NAS 读写 | 写入 `/mnt/nas/metroid-tests/.preflight-{bot}` | 报告 NAS 不可用 |
| LLM API | 调用 LLM 发送 "ping" | 报告 API key 无效 |
| Test Server | `GET {server}/health` | 报告服务器不可达 |
| Agent 存在 | `GET {server}/agents` | 报告需要先创建 agent |

Preflight 结果写入 `board.json` 的 worker status。

---

## Endpoints

### 1. Health Check

```
GET /health
```

Response:
```json
{ "status": "ok", "agents": 2, "uptime": 3600 }
```

### 2. List Test Jobs

```
GET /test/jobs?limit=20
```

Response:
```json
{
  "jobs": [
    {
      "id": "job-1708603200",
      "scenario": "memory-anchor",
      "status": "running",
      "createdAt": "2026-02-22T12:00:00.000Z",
      "subtasks": 4,
      "done": 1,
      "failed": 0
    }
  ]
}
```

### 3. Get Job Details

```
GET /test/jobs/:id
```

Response: 完整的 TestJob 对象，包含所有 subtask 状态和 payload。

### 4. Claim Subtask (领取任务)

```
POST /test/jobs/:id/claim
Content-Type: application/json

{ "worker": "阿凛" }
```

Response (成功):
```json
{
  "subtask": {
    "id": "st-0",
    "jobId": "job-1708603200",
    "status": "claimed",
    "worker": "阿凛",
    "description": "Memory Anchor Recall: steinsgate (enhanced) — ...",
    "payload": {
      "agentId": "",
      "card": "steinsgate",
      "mode": "enhanced",
      "phases": [...],
      "llm": { "baseUrl": "...", "model": "..." }
    },
    "claimedAt": "2026-02-22T12:01:00.000Z"
  }
}
```

Response (无可用任务): `404 { "error": "no pending subtasks" }`

### 5. Submit Result (提交结果)

```
POST /test/jobs/:id/submit
Content-Type: application/json

{
  "subtaskId": "st-0",
  "result": {
    "scores": {
      "recall_avg": 4.2,
      "recall_name": 5,
      "recall_promise": 4,
      "recall_phone": 3,
      "recall_food": 5,
      "recall_secret": 4
    },
    "details": [
      {
        "anchor": "name",
        "classicScore": 1,
        "enhancedScore": 5,
        "classicResponse": "...",
        "enhancedResponse": "..."
      }
    ],
    "timing": {
      "totalMs": 180000,
      "phases": {
        "plant": 30000,
        "dilute": 60000,
        "recall": 90000
      }
    }
  }
}
```

Response:
```json
{ "ok": true, "jobStatus": "running" }
```

如果所有 subtask 都完成，`jobStatus` 会变为 `"done"`。

### 6. Get Report (获取报告)

```
GET /test/jobs/:id/report           # HTML 格式
GET /test/jobs/:id/report?format=json  # JSON 格式
```

---

## board.json 格式

路径: `/mnt/nas/metroid-tests/board.json`

```json
{
  "updated": "2026-02-22T12:00:00Z",
  "activeJob": "job-1708603200",
  "server": "http://192.168.21.111:8100",
  "workers": {
    "阿凛": { "status": "testing", "subtask": "st-0", "lastSeen": "2026-02-22T12:05:00Z" },
    "阿澪": { "status": "idle", "lastSeen": "2026-02-22T12:04:00Z" },
    "Lain": { "status": "preflight", "lastSeen": "2026-02-22T12:03:00Z" },
    "Lumi": { "status": "done", "subtask": "st-1", "lastSeen": "2026-02-22T12:06:00Z" }
  },
  "summary": "2/4 subtasks done, 1 running, 1 pending"
}
```

### Worker Status Values

| Status | 含义 |
|--------|------|
| `idle` | 空闲，等待任务 |
| `preflight` | 正在做环境检查 |
| `testing` | 正在执行测试 |
| `done` | 已完成分配的 subtask |
| `error` | 出错，附带 error 字段 |

### 更新规则

- Worker 每次状态变化时更新自己的 entry
- 更新 `lastSeen` 时间戳
- 更新顶层 `updated` 和 `summary`
- 使用 read-modify-write 模式（NAS 文件锁不可靠，但冲突概率低）

---

## Worker 工作流程

```
1. 读取 board.json → 获取 server URL 和 activeJob
2. Preflight 检查 (NAS / LLM / Server / Agent)
3. 更新 board.json: status = "preflight" → "testing"
4. POST /test/jobs/{activeJob}/claim { "worker": "我的名字" }
5. 根据 subtask.payload 执行测试:
   a. 创建 agent (如果需要)
   b. 按 phases 执行测试轮次
   c. 收集 scores 和 details
6. POST /test/jobs/{activeJob}/submit { "subtaskId": "st-X", "result": {...} }
7. 更新 board.json: status = "done"
8. 检查是否还有 pending subtask → 如果有，回到步骤 4
```

---

## 错误处理

- HTTP 4xx: 请求参数错误，检查 request body
- HTTP 404 on claim: 没有可用的 subtask（可能已被其他 worker 领取）
- HTTP 500: 服务器内部错误，等待后重试
- LLM 调用失败: 在 result 中设置 `error` 字段，仍然 submit
- NAS 不可用: 直接通过 API 工作，跳过 board.json 更新

---

## 创建 Agent (如果需要)

如果 `GET /agents` 返回空列表，需要先创建 agent:

```
POST /agents
Content-Type: application/json

{
  "name": "steinsgate",
  "card": { ... },  // 从 cards/steinsgate.json 读取
  "mode": "enhanced"
}
```
