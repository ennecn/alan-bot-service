#!/usr/bin/env python3
"""用 Node.js CJS 脚本在 Mac Mini 上精确修补 router.js"""
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

# 写一个 Node.js CJS 补丁脚本到 Mac Mini
PATCH_SCRIPT = r"""
const fs = require('fs');
const file = '/Users/fangjin/llm-gateway/router.js';

// 备份
fs.copyFileSync(file, file + '.bak2');
console.log('Backed up to router.js.bak2');

let code = fs.readFileSync(file, 'utf8');
let patches = 0;

// =============================================
// Bug 1: server error cascade 没有 logRequest
// =============================================
const old1 = `        // Handle server errors
        if (isServerError(response.status)) {
          console.log(\`[Router] \${provider.name} server error\`);
          incrementErrorCount(provider.id);
          cascadedFrom = provider.name;
          continue; // Try next provider
        }`;

const new1 = `        // Handle server errors
        if (isServerError(response.status)) {
          console.log(\`[Router] \${provider.name} server error (HTTP \${response.status})\`);
          incrementErrorCount(provider.id);

          logRequest({
            provider_id: provider.id,
            provider_name: provider.name,
            model: model,
            status_code: response.status,
            latency_ms: latencyMs,
            error_type: 'server_error',
            error_message: \`HTTP \${response.status}: \${responseText?.substring(0, 200) || 'N/A'}\`,
            cascaded_from: cascadedFrom,
            client_id: client?.id,
            client_name: client?.name
          });

          cascadedFrom = provider.name;
          continue; // Try next provider
        }`;

if (code.includes(old1)) {
    code = code.replace(old1, new1);
    patches++;
    console.log('✓ Bug 1: server error cascade - added logRequest');
} else {
    console.log('✗ Bug 1: pattern not found');
    // Debug: show what's around "server error"
    const idx = code.indexOf('// Handle server errors');
    if (idx >= 0) {
        console.log('  Found "// Handle server errors" at index', idx);
        console.log('  Context:', JSON.stringify(code.substring(idx, idx + 300)));
    }
}

// =============================================
// Bug 2: OpenAI streaming 没有 logRequest
// =============================================
const old2 = `      if (isOpenAI && response.ok) {
        try {
            console.log(\`[Router] Streaming OpenAI response from \${provider.name} converted to Anthropic format\`);
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
            };`;

const new2 = `      if (isOpenAI && response.ok) {
        try {
            console.log(\`[Router] Streaming OpenAI response from \${provider.name} converted to Anthropic format\`);
            const stream = createOpenAIToAnthropicStream(response, model);
            
            // Notify provider switch only AFTER successful response
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
            };`;

if (code.includes(old2)) {
    code = code.replace(old2, new2);
    patches++;
    console.log('✓ Bug 2: OpenAI streaming - added logRequest + notification');
} else {
    console.log('✗ Bug 2: pattern not found');
    const idx = code.indexOf('isOpenAI && response.ok');
    if (idx >= 0) {
        console.log('  Found "isOpenAI && response.ok" at index', idx);
        console.log('  Context:', JSON.stringify(code.substring(idx, idx + 200)));
    }
}

// =============================================
// Bug 3a: 删除循环开头的提前通知
// =============================================
const old3a = `    // Notify if switching providers
    if (lastActiveProvider && lastActiveProvider !== provider.name) {
      await notifyProviderSwitch(lastActiveProvider, provider.name, 'Failover cascade');
    }`;

const new3a = `    // Provider switch notification moved to AFTER successful response
    // to prevent false notifications before the request is even attempted`;

if (code.includes(old3a)) {
    code = code.replace(old3a, new3a);
    patches++;
    console.log('✓ Bug 3a: removed premature notification from loop start');
} else {
    console.log('✗ Bug 3a: pattern not found');
}

// =============================================
// Bug 3b: Anthropic streaming 成功后添加通知
// =============================================
const old3b = `      // Handle streaming response (only for Anthropic format providers)
      if (requestBody.stream && response.ok && !isOpenAI) {
        lastActiveProvider = provider.name;

        logRequest({`;

const new3b = `      // Handle streaming response (only for Anthropic format providers)
      if (requestBody.stream && response.ok && !isOpenAI) {
        // Notify provider switch only AFTER successful response
        if (lastActiveProvider && lastActiveProvider !== provider.name) {
          await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');
        }
        lastActiveProvider = provider.name;

        logRequest({`;

if (code.includes(old3b)) {
    code = code.replace(old3b, new3b);
    patches++;
    console.log('✓ Bug 3b: Anthropic streaming - added post-success notification');
} else {
    console.log('✗ Bug 3b: pattern not found');
}

// =============================================
// Bug 3c: 非 streaming 成功后添加通知
// =============================================
const old3c = `      // Success!
      lastActiveProvider = provider.name;

      // Convert OpenAI response to Anthropic format`;

const new3c = `      // Success!
      // Notify provider switch only AFTER successful response
      if (lastActiveProvider && lastActiveProvider !== provider.name) {
        await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');
      }
      lastActiveProvider = provider.name;

      // Convert OpenAI response to Anthropic format`;

if (code.includes(old3c)) {
    code = code.replace(old3c, new3c);
    patches++;
    console.log('✓ Bug 3c: non-streaming - added post-success notification');
} else {
    console.log('✗ Bug 3c: pattern not found');
}

// =============================================
// 保存
// =============================================
console.log('\nTotal patches applied:', patches);
if (patches > 0) {
    fs.writeFileSync(file, code);
    console.log('router.js SAVED');
} else {
    console.log('No patches applied, file NOT modified');
}
"""

print("=" * 70)
print("上传并执行补丁脚本...")
print("=" * 70)

sftp_write('/Users/fangjin/llm-gateway/patch_router.cjs', PATCH_SCRIPT)
out, err = run_cmd_mac('/opt/homebrew/bin/node /Users/fangjin/llm-gateway/patch_router.cjs')
print(out)
if err:
    print(f"STDERR: {err}")

# ============================================================
# 重启 Gateway
# ============================================================
print("\n" + "=" * 70)
print("重启 Gateway...")
print("=" * 70)

# 找到当前进程
out, _ = run_cmd_mac('pgrep -f "node server.js" || pgrep -f "node.*server"')
pids = out.strip().split('\n')
for pid in pids:
    pid = pid.strip()
    if pid:
        print(f"  杀掉 PID {pid}")
        run_cmd_mac(f'kill {pid}')

time.sleep(3)

# 检查 launchctl 是否自动重启了
out, _ = run_cmd_mac('pgrep -f "node server.js"')
if out.strip():
    print(f"  ✓ launchctl 自动重启了 Gateway (PID: {out.strip()})")
else:
    # 手动启动
    print("  launchctl 未自动重启，手动启动...")
    run_cmd_mac('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js > /private/tmp/gateway.log 2>&1 &')
    time.sleep(3)
    out, _ = run_cmd_mac('pgrep -f "node server.js"')
    if out.strip():
        print(f"  ✓ 手动启动成功 (PID: {out.strip()})")
    else:
        print("  ✗ 启动失败！")

time.sleep(3)

# ============================================================
# 验证
# ============================================================
print("\n" + "=" * 70)
print("验证修复...")
print("=" * 70)

# 1. Gateway API 可用
out, _ = run_cmd_mac('curl -s http://localhost:8080/api/providers | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null')
print(f"  Gateway providers: {out.strip()}")

# 2. 发个测试请求
out, _ = run_cmd_mac('''curl -s -w "\\nHTTP:%{http_code}" -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 5 --max-time 30''')
for l in out.strip().split('\n')[-2:]:
    if 'HTTP:' in l:
        print(f"  测试请求: {l}")

time.sleep(2)

# 3. 检查日志是否记录了
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=3"')
try:
    logs = json.loads(out)
    for l in logs[:3]:
        print(f"  日志: ID={l['id']} | {l.get('client_name','?'):10} | {l.get('provider_name',''):20} | HTTP {l.get('status_code','?')} | cascade={l.get('cascaded_from','None')}")
except:
    print(f"  日志查询: {out[:200]}")

# 4. 检查 Gateway 日志
out, _ = run_cmd_mac('tail -10 /private/tmp/gateway.log')
print(f"\n  Gateway 日志（最后几行）:")
for line in out.strip().split('\n')[-5:]:
    print(f"    {line[:150]}")

# 5. 验证补丁确实生效了
print("\n  验证补丁内容:")
out, _ = run_cmd_mac('grep -n "Provider switch notification moved" /Users/fangjin/llm-gateway/router.js')
print(f"    通知移除: {'✓' if out.strip() else '✗'} {out.strip()}")
out, _ = run_cmd_mac('grep -n "server_error" /Users/fangjin/llm-gateway/router.js')
print(f"    server error log: {'✓' if out.strip() else '✗'} {out.strip()[:100]}")
out, _ = run_cmd_mac('grep -n "Provider recovered" /Users/fangjin/llm-gateway/router.js')
print(f"    recovered 通知: {'✓' if out.strip() else '✗'} {out.strip()[:100]}")
out, _ = run_cmd_mac('grep -c "logRequest" /Users/fangjin/llm-gateway/router.js')
print(f"    logRequest 调用数: {out.strip()}")

print("\n✅ 全部完成!")
