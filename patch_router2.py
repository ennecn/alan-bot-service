#!/usr/bin/env python3
"""修正 CRLF 问题后重新打补丁"""
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

# 补丁脚本 - 这次处理 CRLF
PATCH_SCRIPT = r"""
const fs = require('fs');
const file = '/Users/fangjin/llm-gateway/router.js';

let code = fs.readFileSync(file, 'utf8');

// Detect line endings
const hasCRLF = code.includes('\r\n');
const NL = hasCRLF ? '\r\n' : '\n';
console.log('Line endings:', hasCRLF ? 'CRLF' : 'LF');

// Helper: create pattern string with correct line endings
function p(s) {
    // Normalize to LF first, then convert to file's line ending
    return s.replace(/\r\n/g, '\n').replace(/\n/g, NL);
}

let patches = 0;

// =============================================
// Bug 1: server error cascade 没有 logRequest
// =============================================
const old1 = p(
`        // Handle server errors\n` +
`        if (isServerError(response.status)) {\n` +
`          console.log(\`[Router] \${provider.name} server error\`);\n` +
`          incrementErrorCount(provider.id);\n` +
`          cascadedFrom = provider.name;\n` +
`          continue; // Try next provider\n` +
`        }`
);

const new1 = p(
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

if (code.includes(old1)) {
    code = code.replace(old1, new1);
    patches++;
    console.log('✓ Bug 1: server error cascade - added logRequest');
} else {
    console.log('✗ Bug 1: pattern not found');
}

// =============================================
// Bug 3a: 删除循环开头的提前通知
// =============================================
const old3a = p(
`    // Notify if switching providers\n` +
`    if (lastActiveProvider && lastActiveProvider !== provider.name) {\n` +
`      await notifyProviderSwitch(lastActiveProvider, provider.name, 'Failover cascade');\n` +
`    }`
);

const new3a = p(
`    // Provider switch notification moved to AFTER successful response\n` +
`    // to prevent false notifications before the request is even attempted`
);

if (code.includes(old3a)) {
    code = code.replace(old3a, new3a);
    patches++;
    console.log('✓ Bug 3a: removed premature notification from loop start');
} else {
    console.log('✗ Bug 3a: pattern not found');
    // Debug
    const idx = code.indexOf('Notify if switching');
    if (idx >= 0) {
        console.log('  Found at index', idx, JSON.stringify(code.substring(idx, idx+200)));
    }
}

// =============================================
// Bug 3b: Anthropic streaming 成功后添加通知
// =============================================
const old3b = p(
`      // Handle streaming response (only for Anthropic format providers)\n` +
`      if (requestBody.stream && response.ok && !isOpenAI) {\n` +
`        lastActiveProvider = provider.name;\n` +
`\n` +
`        logRequest({`
);

const new3b = p(
`      // Handle streaming response (only for Anthropic format providers)\n` +
`      if (requestBody.stream && response.ok && !isOpenAI) {\n` +
`        // Notify provider switch only AFTER successful response\n` +
`        if (lastActiveProvider && lastActiveProvider !== provider.name) {\n` +
`          await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');\n` +
`        }\n` +
`        lastActiveProvider = provider.name;\n` +
`\n` +
`        logRequest({`
);

if (code.includes(old3b)) {
    code = code.replace(old3b, new3b);
    patches++;
    console.log('✓ Bug 3b: Anthropic streaming - added post-success notification');
} else {
    console.log('✗ Bug 3b: pattern not found');
    // Debug
    const idx = code.indexOf('Handle streaming response');
    if (idx >= 0) {
        console.log('  Found at index', idx, JSON.stringify(code.substring(idx, idx+200)));
    }
}

// =============================================
// Bug 3c: 非 streaming 成功后添加通知
// =============================================
const old3c = p(
`      // Success!\n` +
`      lastActiveProvider = provider.name;\n` +
`\n` +
`      // Convert OpenAI response to Anthropic format`
);

const new3c = p(
`      // Success!\n` +
`      // Notify provider switch only AFTER successful response\n` +
`      if (lastActiveProvider && lastActiveProvider !== provider.name) {\n` +
`        await notifyProviderSwitch(lastActiveProvider, provider.name, cascadedFrom ? 'Failover cascade' : 'Provider recovered');\n` +
`      }\n` +
`      lastActiveProvider = provider.name;\n` +
`\n` +
`      // Convert OpenAI response to Anthropic format`
);

if (code.includes(old3c)) {
    code = code.replace(old3c, new3c);
    patches++;
    console.log('✓ Bug 3c: non-streaming - added post-success notification');
} else {
    console.log('✗ Bug 3c: pattern not found');
    const idx = code.indexOf('// Success!');
    if (idx >= 0) {
        console.log('  Found at index', idx, JSON.stringify(code.substring(idx, idx+200)));
    }
}

// =============================================
// 保存
// =============================================
console.log('\nTotal patches applied:', patches);
if (patches > 0) {
    fs.writeFileSync(file, code);
    console.log('router.js SAVED (' + patches + ' patches)');
} else {
    console.log('No new patches applied');
}
"""

print("=" * 70)
print("上传并执行 CRLF 兼容补丁脚本...")
print("=" * 70)

sftp_write('/Users/fangjin/llm-gateway/patch_router2.cjs', PATCH_SCRIPT)
out, err = run_cmd_mac('/opt/homebrew/bin/node /Users/fangjin/llm-gateway/patch_router2.cjs')
print(out)
if err:
    print(f"STDERR: {err}")

# ============================================================
# 重启 Gateway
# ============================================================
print("\n" + "=" * 70)
print("重启 Gateway...")
print("=" * 70)

out, _ = run_cmd_mac('pgrep -f "node server.js" || pgrep -f "node.*server\\.js"')
pids = [p.strip() for p in out.strip().split('\n') if p.strip()]
for pid in pids:
    print(f"  杀掉 PID {pid}")
    run_cmd_mac(f'kill {pid}')

time.sleep(4)

# 检查自动重启
out, _ = run_cmd_mac('pgrep -f "node server.js"')
if out.strip():
    print(f"  ✓ Gateway 自动重启 (PID: {out.strip()})")
else:
    print("  手动启动...")
    run_cmd_mac('cd /Users/fangjin/llm-gateway && nohup /opt/homebrew/bin/node server.js >> /private/tmp/gateway.log 2>&1 &')
    time.sleep(4)
    out, _ = run_cmd_mac('pgrep -f "node server.js"')
    print(f"  {'✓' if out.strip() else '✗'} PID: {out.strip()}")

time.sleep(3)

# ============================================================
# 验证
# ============================================================
print("\n" + "=" * 70)
print("验证所有修复...")
print("=" * 70)

# API 可用
out, _ = run_cmd_mac('curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/providers')
print(f"  Gateway API: HTTP {out.strip()}")

# 测试请求
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

# 日志记录
out, _ = run_cmd_mac('curl -s "http://localhost:8080/api/logs?limit=2"')
try:
    logs = json.loads(out)
    if logs:
        l = logs[0]
        print(f"  最新日志: ID={l['id']} | {l.get('client_name','?')} | {l.get('provider_name','')} | HTTP {l.get('status_code','?')}")
except:
    print(f"  日志: {out[:200]}")

# 验证补丁内容
print("\n  补丁验证:")
checks = [
    ("通知逻辑移除", "Provider switch notification moved"),
    ("server error 日志", "server_error"),
    ("Failover cascade 通知", "Failover cascade"),
    ("Provider recovered 通知", "Provider recovered"),
]
for name, pattern in checks:
    out, _ = run_cmd_mac(f'grep -c "{pattern}" /Users/fangjin/llm-gateway/router.js')
    count = out.strip()
    print(f"    {name}: {'✓' if int(count or 0) > 0 else '✗'} ({count} 处)")

out, _ = run_cmd_mac('grep -c "logRequest" /Users/fangjin/llm-gateway/router.js')
print(f"    logRequest 总调用数: {out.strip()}")

print("\n✅ 全部完成!")
