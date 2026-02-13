# LLM Gateway 修复报告

**日期**: 2026-02-09  
**触发**: Telegram 通知 bot 报告 Provider Switch（Codesome → Antigravity），但 Codesome 额度充足

---

## 一、问题背景

监控 bot 发送了一条 Provider Switch 通知：

```
Provider Switch
From: v3.codesome.cn
To: Antigravity
Reason: Failover cascade
Time: 2026-02-09T17:26:42.126Z
```

Codesome 的每日额度是充足的，不应该触发 failover。需要排查是切换逻辑问题还是 bot 状态异常。

---

## 二、诊断过程

### 2.1 定位 Gateway 真实日志

Gateway 进程的 stdout/stderr 并没有写入 `/Users/fangjin/llm-gateway/gateway.log`（该文件全是旧的崩溃日志），而是写入了 `/private/tmp/gateway.log`。通过 `lsof -p <PID>` 发现了真实的日志路径。

### 2.2 发现根因：Codesome 间歇性 502

从 `/private/tmp/gateway.log` 中发现 Codesome 在 17:08~17:26 期间持续返回 HTTP 502：

```
[17:08:24] Alin → Codesome 502 → cascade Antigravity
[17:14:02] Alin → Codesome 502 → cascade Antigravity
[17:14:29] Alin → Codesome 502 → cascade Antigravity
[17:15:13] Alin → Codesome 跳过 → 直接 Antigravity
[17:16:36] Alin → Codesome 502 → cascade Antigravity
[17:18:15] Alin → Codesome 502 → cascade Antigravity
[17:19:40] Alin → Codesome 502 → cascade Antigravity
[17:23:26] Alin → Codesome 200 ← 短暂恢复
[17:26:27] Alin → Codesome 502 → cascade Antigravity  ← 触发通知
[17:37:04] Aling → Codesome 200 ← 恢复
```

502 是 Codesome 服务端的临时故障，非额度问题。

### 2.3 并发排查

考虑到 Codesome 可能有并发限制，进行了并发测试：

| 测试场景 | 并发数 | 结果 |
|----------|--------|------|
| 直接请求 Codesome | 3 | 全部 200 |
| 直接请求 Codesome | 5 | 全部 200（最慢 7s） |
| Streaming 并发 | 3 | 全部 200 |
| 通过 Gateway 多 bot 同时发 | 3 | 全部 200 |

结论：当前并发量未触发限制。但 Claude Code Bridge 也在直接使用 Codesome（绕过 Gateway），高峰期可能有风险。

---

## 三、发现的问题清单

共发现 **7 个问题**，修复了其中 5 个：

### 问题 1（P0）：launchctl 指向错误 Node.js 版本

| 项目 | 旧值 | 新值 |
|------|------|------|
| node 路径 | `/Users/fangjin/local/bin/node` (v20.20.0) | `/opt/homebrew/bin/node` (v25.2.1) |
| PATH | `/Users/fangjin/local/bin:/usr/bin:/bin` | `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` |
| 日志路径 | `/Users/fangjin/llm-gateway/gateway.log` | `/private/tmp/gateway.log` |

`better-sqlite3` 是为 Node v25 编译的（MODULE_VERSION 141），但 launchctl 启动的是 v20（MODULE_VERSION 115），导致 `ERR_DLOPEN_FAILED` 崩溃。当前 Gateway 是手动用 v25 启动的所以能运行，但 Mac Mini 重启后会崩。

**修复**: 更新 `~/Library/LaunchAgents/com.llm-gateway.plist`。

### 问题 2（P1）：server error cascade 不记录日志

`router.js` 中，当 provider 返回 5xx 时：

```javascript
// 旧代码
if (isServerError(response.status)) {
    incrementErrorCount(provider.id);
    cascadedFrom = provider.name;
    continue; // ← 直接跳过，没有 logRequest()
}
```

导致 502 cascade 在 API 日志中完全不可见。

**修复**: 在 `continue` 前添加 `logRequest()` 调用，记录 `error_type: 'server_error'` 和响应体。

### 问题 3（P1）：OpenAI streaming 成功不记录日志

```javascript
// 旧代码
if (isOpenAI && response.ok) {
    const stream = createOpenAIToAnthropicStream(response, model);
    lastActiveProvider = provider.name;
    resetProviderHealth(provider.id);
    return { status: 200, stream, ... }; // ← 没有 logRequest()
}
```

当请求 cascade 到 Antigravity（OpenAI 格式）并成功时，不会被记录。

**修复**: 在 return 前添加 `logRequest()` 调用。

### 问题 4（P1）：Provider Switch 通知在请求前发送

```javascript
// 旧代码 - 在 for 循环开头
for (const provider of eligibleProviders) {
    // 还没发请求就检查是否要通知！
    if (lastActiveProvider && lastActiveProvider !== provider.name) {
        await notifyProviderSwitch(lastActiveProvider, provider.name, 'Failover cascade');
    }
    // ... 然后才发请求
}
```

这导致两个问题：
1. Codesome 502 cascade 到 Antigravity 时，通知正确但时机不对
2. Codesome 恢复后，下一次请求会在**尝试 Codesome 之前**就发一条 "Failover cascade" 通知（误报）

**修复**: 
- 删除循环开头的通知
- 在三个成功路径（Anthropic streaming / OpenAI streaming / 非 streaming）中，**请求成功后**再发通知
- 区分通知原因：`'Failover cascade'`（有 cascade）vs `'Provider recovered'`（正常恢复）

### 问题 5（P2）：502/503 直接 cascade 不重试

如果 502 是并发限制或短暂抖动导致的，等几秒通常就能恢复，不需要 cascade 到质量可能更低的 Antigravity（Gemini）。

**修复**: 对 502/503 添加一次重试（等待 2 秒后重试同一 provider）：

```
请求 → Codesome 返回 502/503
  ├─ 等 2s → 重试
  │   ├─ 成功 → 正常返回（无 cascade、无通知）
  │   └─ 仍失败 → cascade 到 Antigravity
  └─ 其他 5xx → 直接 cascade
```

### 问题 6（未修复）：Bot `fetch failed` 错误

Aling、Lain、Lumi 三个 bot 有周期性 `TypeError: fetch failed` 错误。可能原因：
- Codesome 502 期间的 API 调用失败
- Telegram API 轮询超时
- OpenAI→Anthropic 流转换的边界情况

需要进一步观察修复后是否减少。

### 问题 7（未修复）：Web IM WebSocket 认证失败

`deploy-openclaw-gateway-1` 有大量 `unauthorized (password_missing)` 错误，来自 Web IM ui v1.0.0 的 WebSocket 连接。属于 web-im 项目的开发问题，后续开发时修复。

---

## 四、修改的文件

### 4.1 `~/Library/LaunchAgents/com.llm-gateway.plist`

- Node.js 路径: `/Users/fangjin/local/bin/node` → `/opt/homebrew/bin/node`
- PATH 环境变量: 添加 `/opt/homebrew/bin`
- 日志路径: 改为 `/private/tmp/gateway.log`

### 4.2 `~/llm-gateway/router.js`

修改了 5 处：

1. **行 ~372**: 删除循环开头的 `notifyProviderSwitch` 调用
2. **行 ~475**: Anthropic streaming 成功后添加 `notifyProviderSwitch`
3. **行 ~504**: OpenAI streaming 成功后添加 `logRequest` + `notifyProviderSwitch`
4. **行 ~622**: server error 处理中添加 `logRequest` + 502/503 重试逻辑
5. **行 ~651**: 非 streaming 成功后添加 `notifyProviderSwitch`

备份文件: `router.js.bak`, `router.js.bak2`

---

## 五、验证结果

| 检查项 | 结果 |
|--------|------|
| Gateway 运行 | ✓ PID 29861, `/opt/homebrew/bin/node` |
| launchctl 服务 | ✓ 已更新，KeepAlive 生效 |
| API 请求 | ✓ HTTP 200, Codesome 路由正常 |
| 日志记录 | ✓ logRequest 调用数从 5 增加到 8 |
| 通知逻辑 | ✓ "Provider recovered" 通知存在 |
| 重试逻辑 | ✓ "retrying in 2s" 代码存在 |

---

## 六、后续建议

1. **监控 502 重试效果**: 观察 `/private/tmp/gateway.log` 中是否出现 `retry succeeded` 日志
2. **CC Bridge 走 Gateway**: 目前 Claude Code Bridge 直接请求 Codesome，建议改为通过 Gateway，实现统一流量管理和限流
3. **Bot fetch failed 观察**: 修复后观察三个 bot 的 `fetch failed` 是否减少
4. **日志轮转**: `/private/tmp/gateway.log` 会持续增长，建议配置 logrotate 或定期清理
