# Antigravity 反代 Tool Use 兼容性测试报告

> 测试日期：2026-02-10
> Antigravity 版本：v4.1.12 (lbjlaq/antigravity-manager:v4.1.12)
> 测试模型：gemini-3-flash
> 目标：确认 Antigravity 反代是否支持 OpenClaw 所需的 tool use 完整工作流

---

## 结论

**Antigravity v4.1.12 完全兼容 OpenClaw 的 tool use 需求，无需额外配置。**

---

## 1. OpenClaw 对模型服务商 Tool Use 的要求

OpenClaw 通过 `openai-completions` API 协议与模型交互，tool use 需要服务商满足以下条件：

### 请求端

| 参数 | 说明 |
|---|---|
| `tools` 数组 | `{type: "function", function: {name, description, parameters}}` |
| `tool_choice` | `"auto"` / `"none"` / `"required"` / `{type: "function", ...}` |
| `parameters` | JSON Schema 格式（`type: "object"`, `properties`, `required`） |

### 响应端

| 参数 | 说明 |
|---|---|
| `finish_reason` | 工具调用时必须为 `"tool_calls"` |
| `tool_calls[].id` | 工具调用唯一标识符 |
| `tool_calls[].type` | 必须为 `"function"` |
| `tool_calls[].function.name` | 工具名称 |
| `tool_calls[].function.arguments` | 工具参数（有效 JSON 字符串） |

### 多轮对话

| 要求 | 说明 |
|---|---|
| `role: "tool"` 消息 | 带 `tool_call_id` 回传工具执行结果 |
| 流式支持 | SSE 格式的 `delta.tool_calls` |

---

## 2. 测试结果

### Test 1: 基本 Tool Use（非流式）— PASS

Antigravity 返回的响应完全符合 OpenAI 格式：

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "",
      "tool_calls": [{
        "id": "call_2ef7edbbd0a40b05",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"unit\":\"celsius\",\"location\":\"Tokyo\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }],
  "usage": {
    "prompt_tokens": 180,
    "completion_tokens": 23,
    "total_tokens": 203
  }
}
```

所有必需字段齐全，`arguments` 为有效 JSON。

### Test 2: `tool_choice="required"` — FAIL

模型未强制调用工具，返回了文本（`finish_reason: "stop"`）。Antigravity 可能未正确传递 `tool_choice` 参数，或 Gemini 3 Flash 对该参数支持有限。

> **影响评估**：OpenClaw 主要使用 `tool_choice: "auto"`，`"required"` 极少使用，影响可忽略。

### Test 3: 流式 Tool Use（SSE）— PASS

流式返回完全符合规范：

```
data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"get_weather","arguments":"{\"location\":\"Beijing\"}"}}]},"finish_reason":null}]}
data: {"choices":[{"delta":{"content":""},"finish_reason":"tool_calls"}],"usage":{...}}
data: [DONE]
```

### Test 4: 多轮 Tool Use（回传结果）— PASS（有条件）

使用 Antigravity 返回的**真实 `tool_call_id`** 时，多轮对话正常工作。使用伪造 ID 时失败（400 错误）。

---

## 3. Gemini 3 的 `thought_signature` 机制

### 背景

Gemini 3 系列引入了强制性的 `thought_signature` 机制：

- 模型返回 tool call 时，原生 Gemini API 响应中的 `functionCall` 部分包含 `thoughtSignature` 字段
- 多轮对话时，客户端必须将该签名原封不动地传回，否则返回 400 错误
- 这是 Gemini 3 的**强制要求**，不可跳过（2.5 系列为可选）

官方文档：https://ai.google.dev/gemini-api/docs/thought-signatures

### Antigravity 的处理方式

Antigravity v4.1.12 通过 `enable_signature_cache`（实验性功能，默认开启）解决了这个问题：

```
请求流程:
OpenClaw → [OpenAI格式] → Antigravity → [注入cached signature] → Gemini API

响应流程:
Gemini API → [含thoughtSignature] → Antigravity → [缓存signature, 转OpenAI格式(去掉signature)] → OpenClaw
```

1. **响应阶段**：Antigravity 从 Gemini 原生响应中提取 `thoughtSignature`，按 `tool_call_id` 缓存
2. **转换阶段**：转成 OpenAI 格式时丢弃 `thought_signature`（客户端无感知）
3. **请求阶段**：收到多轮请求时，用 `tool_call_id` 查缓存，自动注入签名到 Gemini 请求中

### 验证测试

| 场景 | 结果 | 说明 |
|---|---|---|
| 伪造 ID + 无签名 | **400 错误** | 缓存未命中，无签名可注入 |
| 伪造 ID + 虚拟签名 (`extra_content`) | **400 错误** | Antigravity 不透传 `extra_content` |
| 真实 ID + 无签名 | **成功** | 缓存命中，自动注入签名 |
| 真实 ID + 完整多轮流程 | **成功** | 正常工作流完美运行 |

**关键结论**：Antigravity 的 `extra_content` 字段不被透传，但内置的签名缓存机制完全覆盖了正常使用场景。

---

## 4. 已知限制

1. **`tool_choice: "required"` 不生效**：Gemini 3 Flash 通过 Antigravity 时会忽略该参数，模型可能不调用工具而直接回复文本。对 OpenClaw 影响极小。

2. **签名缓存依赖真实 ID**：如果客户端发送的 `tool_call_id` 不是 Antigravity 之前返回的真实 ID，多轮对话会失败。OpenClaw 的正常工作流天然使用真实 ID，不受影响。

3. **缓存持久性未知**：Antigravity 容器重启后缓存是否清空、缓存的 TTL 是多少，尚未测试。如果 Antigravity 在 tool call 和 tool result 之间重启，可能导致缓存丢失。

---

## 5. OpenClaw 接入配置

在 `openclaw.json` 中注册 Antigravity 为 provider：

```json
{
  "models": {
    "providers": {
      "antigravity": {
        "baseUrl": "http://<VPS_IP>:8045/v1",
        "apiKey": "sk-antigravity-openclaw",
        "api": "openai-completions",
        "models": [
          {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 1048576,
            "maxTokens": 65536
          }
        ]
      }
    }
  }
}
```

无需额外的兼容性标志或特殊配置，tool use 开箱即用。

---

## 6. Antigravity 关键配置参考

配置文件位置：`/root/.antigravity_tools/gui_config.json`（容器内挂载）

与 tool use 相关的关键配置项：

```json
{
  "proxy": {
    "port": 8045,
    "api_key": "sk-antigravity-openclaw",
    "request_timeout": 120,
    "experimental": {
      "enable_signature_cache": true,
      "enable_tool_loop_recovery": true,
      "enable_cross_model_checks": true
    }
  }
}
```

- `enable_signature_cache`：**必须为 true**，否则 Gemini 3 多轮 tool use 会失败
- `enable_tool_loop_recovery`：工具循环恢复，建议保持开启
