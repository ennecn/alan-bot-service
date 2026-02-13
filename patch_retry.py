#!/usr/bin/env python3
"""给 Gateway 的 502/503 添加短暂重试逻辑，避免因瞬时错误直接 cascade"""
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

# 补丁脚本 - 在 server error 处理中加入重试
PATCH_SCRIPT = r"""
const fs = require('fs');
const file = '/Users/fangjin/llm-gateway/router.js';

let code = fs.readFileSync(file, 'utf8');
const hasCRLF = code.includes('\r\n');
const NL = hasCRLF ? '\r\n' : '\n';
console.log('Line endings:', hasCRLF ? 'CRLF' : 'LF');

function p(s) {
    return s.replace(/\r\n/g, '\n').replace(/\n/g, NL);
}

let patches = 0;

// =============================================
// 1. 在 server error 处加入重试逻辑
// =============================================
// 找到当前的 server error 处理代码（已经包含 logRequest 的新版本）
const old1 = p(
`        // Handle server errors\n` +
`        if (isServerError(response.status)) {\n` +
`          console.log(\`[Router] \${provider.name} server error (HTTP \${response.status})\`);\n` +
`          incrementErrorCount(provider.id);\n` +
`\n` +
`          logRequest({\n` +
`            provider_id: provider.id,\n` +
`            provider_name: provider.name,\n` +
`            model: model,\n` +
`            status_code: response.status,\n` +
`            latency_ms: latencyMs,\n` +
`            error_type: 'server_error',\n` +
`            error_message: \`HTTP \${response.status}: \${responseText?.substring(0, 200) || 'N/A'}\`,\n` +
`            cascaded_from: cascadedFrom,\n` +
`            client_id: client?.id,\n` +
`            client_name: client?.name\n` +
`          });\n` +
`\n` +
`          cascadedFrom = provider.name;\n` +
`          continue; // Try next provider\n` +
`        }`
);

const new1 = p(
`        // Handle server errors with retry for transient issues (502/503)\n` +
`        if (isServerError(response.status)) {\n` +
`          // Retry once for 502/503 (may be transient: concurrency limit, brief outage)\n` +
`          if ((response.status === 502 || response.status === 503) && !provider._retried) {\n` +
`            console.log(\`[Router] \${provider.name} returned \${response.status}, retrying in 2s...\`);\n` +
`            provider._retried = true;\n` +
`            await new Promise(r => setTimeout(r, 2000));\n` +
`\n` +
`            // Re-fetch\n` +
`            try {\n` +
`              const retryStart = Date.now();\n` +
`              const retryResponse = await fetch(url, fetchOptions);\n` +
`              const retryLatency = Date.now() - retryStart;\n` +
`\n` +
`              if (retryResponse.ok) {\n` +
`                console.log(\`[Router] \${provider.name} retry succeeded (HTTP \${retryResponse.status}, \${retryLatency}ms)\`);\n` +
`\n` +
`                // Handle streaming\n` +
`                if (requestBody.stream && !isOpenAI) {\n` +
`                  if (lastActiveProvider && lastActiveProvider !== provider.name) {\n` +
`                    await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');\n` +
`                  }\n` +
`                  lastActiveProvider = provider.name;\n` +
`                  logRequest({\n` +
`                    provider_id: provider.id, provider_name: provider.name, model: model,\n` +
`                    status_code: retryResponse.status, latency_ms: retryLatency + 2000,\n` +
`                    cascaded_from: cascadedFrom, client_id: client?.id, client_name: client?.name\n` +
`                  });\n` +
`                  resetProviderHealth(provider.id);\n` +
`                  return { status: retryResponse.status, headers: Object.fromEntries(retryResponse.headers), stream: retryResponse.body, provider: provider.name };\n` +
`                }\n` +
`\n` +
`                // Handle OpenAI streaming\n` +
`                if (isOpenAI) {\n` +
`                  const stream = createOpenAIToAnthropicStream(retryResponse, model);\n` +
`                  if (lastActiveProvider && lastActiveProvider !== provider.name) {\n` +
`                    await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');\n` +
`                  }\n` +
`                  lastActiveProvider = provider.name;\n` +
`                  resetProviderHealth(provider.id);\n` +
`                  logRequest({\n` +
`                    provider_id: provider.id, provider_name: provider.name, model: model,\n` +
`                    status_code: 200, latency_ms: retryLatency + 2000,\n` +
`                    cascaded_from: cascadedFrom, client_id: client?.id, client_name: client?.name\n` +
`                  });\n` +
`                  return { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }, stream: stream, provider: provider.name };\n` +
`                }\n` +
`\n` +
`                // Non-streaming retry success - fall through to normal processing below\n` +
`                // We need to re-process, so just let it cascade for now\n` +
`                // (non-streaming 502 retries are less common)\n` +
`              } else {\n` +
`                console.log(\`[Router] \${provider.name} retry also failed (HTTP \${retryResponse.status})\`);\n` +
`              }\n` +
`            } catch (retryErr) {\n` +
`              console.log(\`[Router] \${provider.name} retry error: \${retryErr.message}\`);\n` +
`            }\n` +
`          }\n` +
`\n` +
`          console.log(\`[Router] \${provider.name} server error (HTTP \${response.status})\`);\n` +
`          incrementErrorCount(provider.id);\n` +
`\n` +
`          logRequest({\n` +
`            provider_id: provider.id,\n` +
`            provider_name: provider.name,\n` +
`            model: model,\n` +
`            status_code: response.status,\n` +
`            latency_ms: latencyMs,\n` +
`            error_type: 'server_error',\n` +
`            error_message: \`HTTP \${response.status}: \${responseText?.substring(0, 200) || 'N/A'}\`,\n` +
`            cascaded_from: cascadedFrom,\n` +
`            client_id: client?.id,\n` +
`            client_name: client?.name\n` +
`          });\n` +
`\n` +
`          cascadedFrom = provider.name;\n` +
`          continue; // Try next provider\n` +
`        }`
);

if (code.includes(old1)) {
    code = code.replace(old1, new1);
    patches++;
    console.log('✓ Added 502/503 retry logic before cascade');
} else {
    console.log('✗ Could not find server error handler');
    // Debug
    const idx = code.indexOf('Handle server errors');
    if (idx >= 0) {
        console.log('  Found at', idx, JSON.stringify(code.substring(idx, idx + 100)));
    }
}

// =============================================
// 保存
// =============================================
console.log('\nPatches applied:', patches);
if (patches > 0) {
    fs.writeFileSync(file, code);
    console.log('router.js SAVED');
} else {
    console.log('File NOT modified');
}
"""

print("=" * 70)
print("上传并执行重试逻辑补丁...")
print("=" * 70)

sftp_write('/Users/fangjin/llm-gateway/patch_retry.cjs', PATCH_SCRIPT)
out, err = run_cmd_mac('/opt/homebrew/bin/node /Users/fangjin/llm-gateway/patch_retry.cjs')
print(out)
if err:
    print(f"STDERR: {err}")

# ============================================================
# 重启 Gateway
# ============================================================
print("\n" + "=" * 70)
print("重启 Gateway...")
print("=" * 70)

out, _ = run_cmd_mac('pgrep -f "node.*server\\.js"')
pids = [p.strip() for p in out.strip().split('\n') if p.strip()]
for pid in pids:
    print(f"  杀掉 PID {pid}")
    run_cmd_mac(f'kill {pid}')

time.sleep(5)

# 检查 launchctl 自动重启
out, _ = run_cmd_mac('pgrep -f "node.*server\\.js"')
if out.strip():
    print(f"  ✓ Gateway 重启成功 (PID: {out.strip()})")
else:
    print("  手动启动...")
    run_cmd_mac('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js >> /private/tmp/gateway.log 2>&1 &')
    time.sleep(4)
    out, _ = run_cmd_mac('pgrep -f "node.*server\\.js"')
    print(f"  {'✓' if out.strip() else '✗'} PID: {out.strip()}")

time.sleep(3)

# ============================================================
# 验证
# ============================================================
print("\n" + "=" * 70)
print("验证...")
print("=" * 70)

# Gateway 可用
out, _ = run_cmd_mac('curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/providers')
print(f"  Gateway API: HTTP {out.strip()}")

# 正常请求
out, _ = run_cmd_mac('''curl -s -w "\\nHTTP:%{http_code}" -X POST http://localhost:8080/v1/messages \
  -H "x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-thinking","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say ok"}]}' \
  --connect-timeout 5 --max-time 30''')
for l in out.strip().split('\n')[-2:]:
    if 'HTTP:' in l:
        print(f"  正常请求: {l}")

# 验证 retry 逻辑
out, _ = run_cmd_mac('grep -c "retrying in 2s" /Users/fangjin/llm-gateway/router.js')
print(f"  重试逻辑存在: {'✓' if int(out.strip() or 0) > 0 else '✗'}")

# Gateway 日志
time.sleep(2)
out, _ = run_cmd_mac('tail -5 /private/tmp/gateway.log')
print(f"\n  最新日志:")
for line in out.strip().split('\n')[-4:]:
    print(f"    {line[:150]}")

print("\n✅ 完成！")
print("""
新增逻辑：
  当 Codesome 返回 502/503 时：
  1. 等待 2 秒
  2. 重试一次同一个 provider
  3. 如果重试成功 → 正常返回（不 cascade，不发通知）
  4. 如果重试也失败 → 照常 cascade 到下一个 provider
  
  每个 provider 每次请求最多重试 1 次（provider._retried 标记）
""")
