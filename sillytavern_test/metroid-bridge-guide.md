# Metroid Bridge — ST 真实 Prompt 截获方案

## 概述

Metroid Bridge 是一套 SillyTavern 插件 + 前端扩展 + Python 客户端的组合，用于**程序化截获 ST 前端真实组装的 prompt**。

核心思路：不重写 ST 的 prompt 组装逻辑，而是用 ST 自身作为黑盒——通过前端扩展监听 `CHAT_COMPLETION_PROMPT_READY` 事件，拿到 ST 前端真实输出的 messages 数组。

## 架构

```
Python 测试脚本                 服务端插件                      前端扩展
(metroid_bridge_client.py)     (plugins/metroid-bridge/)      (extensions/metroid-bridge/)
    │                              │                            │
    ├─ POST /send-message ────→ 存入 pending queue              │
    │                              │                            │
    │                              │ ←── GET /pending ──────── 每500ms轮询
    │                              │                            │
    │                              │ ──→ 返回 pending msg ────→ │
    │                              │                            │
    │                              │     写入 #send_textarea    │
    │                              │     点击 #send_but         │
    │                              │                            │
    │                              │     ST 前端组装 prompt     │
    │                              │     触发 PROMPT_READY ──→  │
    │                              │                            │
    │                              │ ←── POST /store-prompt ── 深拷贝并存储
    │                              │                            │
    ├─ GET /last-prompt ────────→ 返回截获的 prompt (长轮询)     │
    │                              │                            │
```

## 文件位置

```
D:\SillyTavern\SillyTavern-Launcher\SillyTavern\
  plugins/metroid-bridge/
    index.mjs                  ← 服务端插件（Express 路由）

  public/scripts/extensions/third-party/metroid-bridge/
    manifest.json              ← 扩展清单
    index.js                   ← 前端扩展（事件监听 + 轮询）

D:\openclawVPS\sillytavern_test\
    metroid_bridge_client.py   ← Python 客户端
    test_metroid_bridge.py     ← 端到端测试
    st_client.py               ← 已有的 ST REST API 客户端（被复用）
```

## 前置条件

1. SillyTavern 已安装并可运行
2. `config.yaml` 中启用了服务端插件：
   ```yaml
   enableServerPlugins: true
   ```
3. 浏览器中打开 ST Web UI（前端扩展需要浏览器环境）
4. Python 3.8+ 且安装了 `requests`

## 安装

插件和扩展文件已经放在正确位置，只需重启 ST：

```bash
# 重启 SillyTavern
cd "D:\SillyTavern\SillyTavern-Launcher\SillyTavern"
npm start
```

重启后在浏览器中打开 ST，前端扩展会自动加载。

验证安装：
```bash
# 检查服务端插件
curl http://127.0.0.1:8000/api/plugins/metroid-bridge/status

# 或用 Python
python sillytavern_test/test_metroid_bridge.py --check
```

预期输出：
```json
{"ok": true, "has_pending": false, "has_prompt": false, "prompt_message_count": 0, "waiters": 0}
```

## 使用方法

### 方式一：Python 脚本

```python
from metroid_bridge_client import MetroidBridge

bridge = MetroidBridge("http://127.0.0.1:8000")

# 可选：导入角色卡和世界书
bridge.setup("Rachel.png", ["genshin.json"])

# 发送消息并截获 ST 真实 prompt
prompt = bridge.send_and_capture("Hello!", character="Rachel.png")

# prompt 是 [{role: "system", content: "..."}, ...] 数组
for msg in prompt:
    print(f"[{msg['role']}] {msg['content'][:100]}")
```

### 方式二：直接调用 API

```bash
# 1. 发送消息到队列
curl -X POST http://127.0.0.1:8000/api/plugins/metroid-bridge/send-message \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'

# 2. 等待前端处理后获取 prompt（长轮询）
curl "http://127.0.0.1:8000/api/plugins/metroid-bridge/last-prompt?wait=true&timeout=15000"

# 3. 清理状态
curl -X POST http://127.0.0.1:8000/api/plugins/metroid-bridge/clear
```

### 方式三：运行端到端测试

```bash
cd D:\openclawVPS

# 仅检查连通性
python sillytavern_test/test_metroid_bridge.py --check

# 运行全部测试
python sillytavern_test/test_metroid_bridge.py

# 指定 ST 地址
python sillytavern_test/test_metroid_bridge.py --url http://192.168.21.146:8000
```

## 对比测试流程

### 目标

验证 Metroid 的 prompt 组装输出与 ST 前端真实输出的一致性。

### Step 1：用 Bridge 截获 ST 真实 prompt

```python
from metroid_bridge_client import MetroidBridge

bridge = MetroidBridge()

# 确保 ST 中已选择目标角色卡
prompt_st = bridge.send_and_capture("你好！", character="芙莉莲.png")

# 保存为 JSON 供后续对比
import json
with open("prompt_st.json", "w") as f:
    json.dump(prompt_st, f, ensure_ascii=False, indent=2)
```

### Step 2：用 Metroid 组装同场景 prompt

```python
# 假设 Metroid 有类似的 API
from metroid_compiler import compile_prompt

prompt_metroid = compile_prompt(
    character="芙莉莲.png",
    message="你好！",
    worldinfo=["genshin.json"],
)
```

或者用已有的 ChatBridge 插件（服务端简化版组装）：

```python
from st_client import STClient

client = STClient()
result = client.chatbridge_assemble("芙莉莲.png", "你好！", worldinfo=["genshin.json"])
prompt_chatbridge = result["messages"]
```

### Step 3：逐条对比

```python
bridge.compare_prompts(prompt_st, prompt_metroid, label="metroid")
```

输出示例：
```
[DIFF] msg[0] content differs at char 156:
  ST:    ...Write 芙莉莲's next reply in a fictional roleplay...
  metroid: ...Write 芙莉莲's next reply in a fictional chat...
[DIFF] Total differences: 1
```

### Step 4：批量回归测试

```python
test_cases = [
    {"character": "Rachel.png", "message": "Hello!"},
    {"character": "芙莉莲.png", "message": "你好！", "worldinfo": ["genshin.json"]},
    {"character": "Rachel.png", "message": "Tell me about yourself", "multiturn": True},
]

for tc in test_cases:
    prompt_st = bridge.send_and_capture(tc["message"], character=tc["character"])
    prompt_metroid = metroid_compile(tc)  # 你的 Metroid 实现
    match = bridge.compare_prompts(prompt_st, prompt_metroid)
    print(f"{'PASS' if match else 'FAIL'}: {tc['character']} / {tc['message'][:30]}")
```

## API 参考

### 服务端插件路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/plugins/metroid-bridge/send-message` | 发送消息到队列 |
| GET | `/api/plugins/metroid-bridge/pending` | 前端轮询待处理消息 |
| POST | `/api/plugins/metroid-bridge/store-prompt` | 前端存储截获的 prompt |
| GET | `/api/plugins/metroid-bridge/last-prompt` | 获取最近截获的 prompt |
| POST | `/api/plugins/metroid-bridge/clear` | 重置状态 |
| GET | `/api/plugins/metroid-bridge/status` | 健康检查 |

### send-message

```json
// Request
{"message": "Hello!", "character": "Rachel.png"}

// Response
{"ok": true, "queued": true}
```

`character` 可选。如果提供，前端扩展会先通过 `selectCharacterById()` 切换角色。

### last-prompt

```
GET /api/plugins/metroid-bridge/last-prompt?wait=true&timeout=15000
```

- `wait=true`：启用长轮询，等待 prompt 到达
- `timeout`：最大等待时间（毫秒），上限 30000

```json
// Response (成功)
{
  "ok": true,
  "prompt": {
    "messages": [
      {"role": "system", "content": "..."},
      {"role": "assistant", "content": "..."},
      {"role": "user", "content": "Hello!"}
    ],
    "character": "Rachel",
    "timestamp": "2026-02-25T08:00:00.000Z",
    "captured_at": 1740470400000
  }
}

// Response (超时)
{"ok": false, "prompt": null, "reason": "timeout"}
```

## 注意事项

1. **浏览器必须打开**：前端扩展在浏览器中运行，ST 的 Web UI 标签页必须保持打开
2. **串行发送**：一次只处理一条消息，测试脚本需要等上一条完成再发下一条
3. **LLM 会被真实调用**：截获 prompt 后 ST 会继续把请求发给 LLM。如果不想产生实际调用，可以：
   - 配置一个不存在的 API endpoint（ST 会报错但 prompt 已被截获）
   - 配合 `st_prompt_interceptor.py` 拦截请求
4. **角色卡选择**：`character` 参数通过前端 `selectCharacterById()` 切换，需要角色卡已导入 ST
5. **CSRF**：Python 客户端复用 `STClient` 的 session，自动处理 CSRF token

## Troubleshooting

| 问题 | 原因 | 解决 |
|------|------|------|
| `status` 返回 None | 插件未加载 | 检查 `config.yaml` 的 `enableServerPlugins: true`，重启 ST |
| `send_and_capture` 超时 | 前端扩展未运行 | 在浏览器中打开 ST，检查 console 有无 `[MetroidBridge]` 日志 |
| prompt 只有 1 条消息 | 角色卡未选择 | 先在 ST UI 中手动选择角色，或传 `character` 参数 |
| CSRF 错误 | token 过期 | 重新创建 `MetroidBridge` 实例 |
