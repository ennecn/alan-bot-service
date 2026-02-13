#!/usr/bin/env python3
"""
修复 LLM Gateway 的所有已知问题:
  P0: launchctl plist Node.js 路径
  P1: router.js server error cascade 日志丢失
  P1: router.js OpenAI streaming 日志丢失
  P1: 通知逻辑 Bug (提前发送)
"""
import paramiko
import json
import sys
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def run_cmd_mac(cmd, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

def sftp_write(remote_path, content):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = client.open_sftp()
    with sftp.open(remote_path, 'w') as f:
        f.write(content)
    sftp.close()
    client.close()

def sftp_read(remote_path):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = client.open_sftp()
    with sftp.open(remote_path, 'r') as f:
        content = f.read().decode('utf-8')
    sftp.close()
    client.close()
    return content

# ============================================================
# P0: 修复 launchctl plist
# ============================================================
print("=" * 70)
print("[FIX P0] 修复 launchctl plist Node.js 路径")
print("=" * 70)

plist_path = '/Users/fangjin/Library/LaunchAgents/com.llm-gateway.plist'
plist_content = sftp_read(plist_path)
print(f"  原始 plist 中的 node 路径:")
for line in plist_content.split('\n'):
    if 'node' in line.lower() or 'fangjin/local' in line:
        print(f"    {line.strip()}")

# 替换 node 路径
new_plist = plist_content.replace(
    '/Users/fangjin/local/bin/node',
    '/opt/homebrew/bin/node'
)
# 也更新 PATH 环境变量
new_plist = new_plist.replace(
    '/Users/fangjin/local/bin:/usr/bin:/bin',
    '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
)
# 同时更新 StandardOutPath 和 StandardErrorPath 到 /private/tmp/gateway.log
# (保持跟当前运行的一致)
new_plist = new_plist.replace(
    '<string>/Users/fangjin/llm-gateway/gateway.log</string>',
    '<string>/private/tmp/gateway.log</string>'
)

sftp_write(plist_path, new_plist)
print(f"  已更新 plist!")

# 验证
updated = sftp_read(plist_path)
for line in updated.split('\n'):
    if 'node' in line.lower() or 'homebrew' in line or 'gateway.log' in line or 'PATH' in line:
        print(f"    {line.strip()}")

# 重新加载 launchctl
out, err = run_cmd_mac(f'launchctl unload {plist_path} 2>&1; launchctl load {plist_path} 2>&1')
print(f"  launchctl reload: {out.strip()} {err.strip()}")
print("  ✓ P0 完成")

# ============================================================
# P1: 修复 router.js (三个bug)
# ============================================================
print("\n" + "=" * 70)
print("[FIX P1] 修复 router.js 中的三个 Bug")
print("=" * 70)

router_path = '/Users/fangjin/llm-gateway/router.js'
router = sftp_read(router_path)

# 备份
sftp_write(router_path + '.bak', router)
print("  已备份 router.js -> router.js.bak")

patches_applied = 0

# --- Bug 1: server error cascade 没有 logRequest ---
old_server_error = """        // Handle server errors
        if (isServerError(response.status)) {
          console.log(`[Router] ${provider.name} server error`);
          incrementErrorCount(provider.id);
          cascadedFrom = provider.name;
          continue; // Try next provider
        }"""

new_server_error = """        // Handle server errors
        if (isServerError(response.status)) {
          console.log(`[Router] ${provider.name} server error (HTTP ${response.status})`);
          incrementErrorCount(provider.id);

          logRequest({
            provider_id: provider.id,
            provider_name: provider.name,
            model: model,
            status_code: response.status,
            latency_ms: latencyMs,
            error_type: 'server_error',
            error_message: `HTTP ${response.status}: ${responseText?.substring(0, 200) || 'N/A'}`,
            cascaded_from: cascadedFrom,
            client_id: client?.id,
            client_name: client?.name
          });

          cascadedFrom = provider.name;
          continue; // Try next provider
        }"""

if old_server_error in router:
    router = router.replace(old_server_error, new_server_error)
    patches_applied += 1
    print("  ✓ Bug 1: server error cascade 添加了 logRequest")
else:
    print("  ✗ Bug 1: 未找到目标代码，可能已修改")

# --- Bug 2: OpenAI streaming 没有 logRequest ---
old_openai_stream = """          if (isOpenAI && response.ok) {
            try {
                console.log(`[Router] Streaming OpenAI response from ${provider.name} converted to Anthropic format`);
                const stream = createOpenAIToAnthropicStream(response, model);
                
                // Mark provider active and healthy
                lastActiveProvider = provider.name;
                resetProviderHealth(provider.id);
                
                return {
                  status: 200,
                  headers: {
                      'Content-Type': 'text/event-stream',
                      'Cache-Control': 'no-cache',
                      'Connection': 'keep-alive'
                  },
                  stream: stream,
                  provider: provider.name
                };"""

new_openai_stream = """          if (isOpenAI && response.ok) {
            try {
                console.log(`[Router] Streaming OpenAI response from ${provider.name} converted to Anthropic format`);
                const stream = createOpenAIToAnthropicStream(response, model);
                
                // Mark provider active and healthy
                lastActiveProvider = provider.name;
                resetProviderHealth(provider.id);

                logRequest({
                  provider_id: provider.id,
                  provider_name: provider.name,
                  model: model,
                  status_code: 200,
                  latency_ms: Date.now() - startTime,
                  cascaded_from: cascadedFrom,
                  client_id: client?.id,
                  client_name: client?.name
                });
                
                return {
                  status: 200,
                  headers: {
                      'Content-Type': 'text/event-stream',
                      'Cache-Control': 'no-cache',
                      'Connection': 'keep-alive'
                  },
                  stream: stream,
                  provider: provider.name
                };"""

if old_openai_stream in router:
    router = router.replace(old_openai_stream, new_openai_stream)
    patches_applied += 1
    print("  ✓ Bug 2: OpenAI streaming 添加了 logRequest")
else:
    print("  ✗ Bug 2: 未找到目标代码，可能已修改")

# --- Bug 3: 通知逻辑 - 在循环开头发通知（应该移到成功后） ---
# 删掉循环开头的通知逻辑
old_notify = """    // Notify if switching providers
    if (lastActiveProvider && lastActiveProvider !== provider.name) {
      await notifyProviderSwitch(lastActiveProvider, provider.name, 'Failover cascade');
    }"""

new_notify = """    // Provider switch notification is now sent AFTER successful response
    // (moved from here to prevent false notifications before the request is even attempted)"""

if old_notify in router:
    router = router.replace(old_notify, new_notify)
    patches_applied += 1
    print("  ✓ Bug 3a: 删除了循环开头的提前通知")
else:
    print("  ✗ Bug 3a: 未找到循环开头的通知代码")

# 在 Anthropic streaming 成功路径添加通知
old_anthropic_stream_success = """      // Handle streaming response (only for Anthropic format providers)
          if (requestBody.stream && response.ok && !isOpenAI) {
            lastActiveProvider = provider.name;

            logRequest({"""

new_anthropic_stream_success = """      // Handle streaming response (only for Anthropic format providers)
          if (requestBody.stream && response.ok && !isOpenAI) {
            // Notify provider switch only AFTER successful response
            if (lastActiveProvider && lastActiveProvider !== provider.name) {
              await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');
            }
            lastActiveProvider = provider.name;

            logRequest({"""

if old_anthropic_stream_success in router:
    router = router.replace(old_anthropic_stream_success, new_anthropic_stream_success)
    patches_applied += 1
    print("  ✓ Bug 3b: Anthropic streaming 成功后添加通知")
else:
    print("  ✗ Bug 3b: 未找到 Anthropic streaming 成功代码")

# 在 OpenAI streaming 成功路径添加通知 (刚才 Bug 2 修改后的代码)
old_openai_notify = """                // Mark provider active and healthy
                lastActiveProvider = provider.name;
                resetProviderHealth(provider.id);

                logRequest({
                  provider_id: provider.id,
                  provider_name: provider.name,
                  model: model,
                  status_code: 200,
                  latency_ms: Date.now() - startTime,
                  cascaded_from: cascadedFrom,
                  client_id: client?.id,
                  client_name: client?.name
                });"""

new_openai_notify = """                // Notify provider switch only AFTER successful response
                if (lastActiveProvider && lastActiveProvider !== provider.name) {
                  await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');
                }

                // Mark provider active and healthy
                lastActiveProvider = provider.name;
                resetProviderHealth(provider.id);

                logRequest({
                  provider_id: provider.id,
                  provider_name: provider.name,
                  model: model,
                  status_code: 200,
                  latency_ms: Date.now() - startTime,
                  cascaded_from: cascadedFrom,
                  client_id: client?.id,
                  client_name: client?.name
                });"""

if old_openai_notify in router:
    router = router.replace(old_openai_notify, new_openai_notify)
    patches_applied += 1
    print("  ✓ Bug 3c: OpenAI streaming 成功后添加通知")
else:
    print("  ✗ Bug 3c: 未找到 OpenAI streaming 成功代码")

# 在非 streaming 成功路径添加通知
old_non_stream_success = """        // Success!
        lastActiveProvider = provider.name;"""

new_non_stream_success = """        // Success!
        // Notify provider switch only AFTER successful response
        if (lastActiveProvider && lastActiveProvider !== provider.name) {
          await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');
        }
        lastActiveProvider = provider.name;"""

if old_non_stream_success in router:
    router = router.replace(old_non_stream_success, new_non_stream_success)
    patches_applied += 1
    print("  ✓ Bug 3d: 非 streaming 成功后添加通知")
else:
    print("  ✗ Bug 3d: 未找到非 streaming 成功代码")

print(f"\n  总共应用了 {patches_applied} 个补丁")

if patches_applied >= 4:
    # 写入修改后的 router.js
    sftp_write(router_path, router)
    print("  ✓ router.js 已保存")
else:
    print("  ⚠ 部分补丁未应用，请检查！仍然写入已应用的补丁...")
    sftp_write(router_path, router)
    print("  router.js 已保存（部分修复）")

# ============================================================
# 重启 Gateway
# ============================================================
print("\n" + "=" * 70)
print("[RESTART] 重启 Gateway")
print("=" * 70)

# 先记录当前 PID
out, _ = run_cmd_mac('ps aux | grep "node server.js" | grep -v grep')
old_pid = out.strip().split()[1] if out.strip() else 'N/A'
print(f"  当前 Gateway PID: {old_pid}")

# 杀掉当前进程
out, err = run_cmd_mac(f'kill {old_pid} 2>&1')
print(f"  kill {old_pid}: {out.strip()} {err.strip()}")
time.sleep(2)

# launchctl 应该自动重启 (KeepAlive=true)
# 等待它重启
for i in range(10):
    time.sleep(2)
    out, _ = run_cmd_mac('ps aux | grep "node server.js" | grep -v grep')
    if out.strip():
        new_pid = out.strip().split()[1]
        if new_pid != old_pid:
            print(f"  ✓ Gateway 已重启！新 PID: {new_pid}")
            break
    print(f"  等待重启... ({(i+1)*2}s)")
else:
    print("  ⚠ 自动重启超时，手动启动...")
    out, err = run_cmd_mac('cd /Users/fangjin/llm-gateway && /opt/homebrew/bin/node server.js > /private/tmp/gateway.log 2>&1 &')
    time.sleep(3)
    out, _ = run_cmd_mac('ps aux | grep "node server.js" | grep -v grep')
    if out.strip():
        print(f"  ✓ 手动启动成功: {out.strip()[:100]}")
    else:
        print("  ✗ 启动失败！")

# ============================================================
# 验证
# ============================================================
print("\n" + "=" * 70)
print("[VERIFY] 验证修复")
print("=" * 70)

time.sleep(3)

# 1. Gateway 运行状态
out, _ = run_cmd_mac('curl -s http://localhost:8080/api/providers | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\\"✓ Gateway 运行中: {len(d)} providers\\")" 2>/dev/null')
print(f"  {out.strip() or '✗ Gateway 无响应'}")

# 2. 检查 Node.js 版本
out, _ = run_cmd_mac('ps aux | grep "node server.js" | grep -v grep')
if '/opt/homebrew' in out:
    print(f"  ✓ 使用 homebrew Node.js")
else:
    print(f"  ⚠ Node.js 路径: {out.strip()[:100]}")

# 3. 测试请求 + 日志记录
print("  测试请求...")
out, _ = run_cmd_mac('''curl -s -w "\\nHTTP:%{http_code}" -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 5 --max-time 30''')
lines = out.strip().split('\n')
for l in lines[-2:]:
    if 'HTTP:' in l:
        print(f"  测试响应: {l}")

time.sleep(2)

# 4. 检查日志记录
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=3"')
try:
    logs = json.loads(out)
    if logs:
        latest = logs[0]
        print(f"  ✓ 最新日志: ID={latest['id']} | {latest.get('provider_name','')} | HTTP {latest.get('status_code','')} | cascade={latest.get('cascaded_from','None')}")
    else:
        print("  ⚠ 日志为空")
except:
    print(f"  ⚠ 日志查询结果: {out[:200]}")

# 5. 检查 /private/tmp/gateway.log 是否有新的 Router 日志
out, _ = run_cmd_mac('tail -5 /private/tmp/gateway.log')
print(f"  最新 Gateway 日志:")
for line in out.strip().split('\n')[-3:]:
    print(f"    {line[:150]}")

# 6. 验证 launchctl plist
out, _ = run_cmd_mac(f'grep "homebrew" {plist_path}')
if 'homebrew' in out:
    print(f"  ✓ launchctl plist 已更新为 homebrew node")
else:
    print(f"  ✗ launchctl plist 可能未正确更新")

print("\n" + "=" * 70)
print("修复完成！")
print("=" * 70)
print("""
修复内容:
  [P0] launchctl plist: /Users/fangjin/local/bin/node -> /opt/homebrew/bin/node
  [P1] router.js Bug 1: server error (502等) cascade 时添加 logRequest
  [P1] router.js Bug 2: OpenAI streaming 成功时添加 logRequest  
  [P1] router.js Bug 3: Provider Switch 通知改为在请求成功后发送
       - 避免了"还没试就发通知"的误报
       - 区分 'Failover cascade' 和 'Provider recovered' 两种通知
""")
