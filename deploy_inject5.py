#!/usr/bin/env python3
"""Update inject script to accept sessionKey, update hook to construct it"""
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# 1. Update inject script to accept sessionKey as arg
inject_js = r'''#!/usr/bin/env node
// claude-code-inject.js v5 - Inject message into specific session
// Usage: node inject.js <message> <sessionKey>
//   or:  node inject.js <message> wake
const message = process.argv[2];
const sessionKeyOrMethod = process.argv[3] || "wake";
if (!message) { console.error("Usage: node inject.js <message> <sessionKey|wake>"); process.exit(1); }

const isWake = sessionKeyOrMethod === "wake";
const GATEWAY_URL = "ws://127.0.0.1:18789";
const GATEWAY_PASSWORD = process.env.OPENCLAW_GATEWAY_PASSWORD || "openclaw123";

const ws = new WebSocket(GATEWAY_URL);
let step = "connecting";
const timer = setTimeout(() => { console.error("TIMEOUT at step:", step); process.exit(1); }, 10000);

ws.addEventListener("open", () => { step = "waiting-challenge"; });
ws.addEventListener("message", (event) => {
  try {
    const msg = JSON.parse(event.data);

    if (msg.type === "event" && msg.event === "connect.challenge") {
      step = "sending-connect";
      ws.send(JSON.stringify({
        type: "req", id: "c1", method: "connect",
        params: {
          minProtocol: 3, maxProtocol: 3,
          client: { id: "gateway-client", version: "1.0.0", platform: "node", mode: "backend" },
          auth: { password: GATEWAY_PASSWORD }
        }
      }));
      return;
    }

    if (msg.type === "res" && msg.id === "c1") {
      if (!msg.ok) { console.error("Connect failed:", JSON.stringify(msg.error)); ws.close(); process.exit(1); }
      step = "sending-action";

      if (isWake) {
        ws.send(JSON.stringify({ type: "req", id: "w1", method: "wake", params: { mode: "now", text: message } }));
      } else {
        ws.send(JSON.stringify({ type: "req", id: "w1", method: "chat.inject", params: { sessionKey: sessionKeyOrMethod, message: message } }));
      }
      return;
    }

    if (msg.type === "res" && msg.id === "w1") {
      clearTimeout(timer); step = "done";
      if (!msg.ok) { console.error("Failed:", JSON.stringify(msg.error)); ws.close(); process.exit(1); }
      console.log("OK");
      ws.close(); process.exit(0);
    }
  } catch(e) {}
});
ws.addEventListener("error", (e) => { console.error("WS error:", e.message || e.type); process.exit(1); });
'''

with sftp.file('/Users/fangjin/claude-code-inject.js', 'w') as f:
    f.write(inject_js)
print("[1/2] inject.js v5 deployed (supports sessionKey)")

# 2. Update hook to construct sessionKey and use inject
with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'r') as f:
    hook = f.read().decode()

old_section = '''# ---- Notify AGI via WebSocket inject ----
WAKE_TEXT="[Claude Code 任务完成] 任务 '${TASK_NAME}' 已完成。请读取 /Users/fangjin/claude-code-results/latest.json 获取结果，然后向用户汇报。"
/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$WAKE_TEXT" \
    > /dev/null 2>&1 \
    && log "WebSocket inject sent" \
    || log "WebSocket inject failed (non-fatal)"'''

# The hook has the lines joined without backslash-newline, let me match the actual content
# Let me read the actual lines
lines = hook.split('\n')
inject_start = -1
inject_end = -1
for i, line in enumerate(lines):
    if 'Notify AGI via WebSocket' in line:
        inject_start = i
    if inject_start >= 0 and 'WebSocket inject' in line and ('sent' in line or 'failed' in line):
        inject_end = i
        break

if inject_start >= 0 and inject_end >= 0:
    new_section = '''# ---- Notify AGI via WebSocket chat.inject ----
# Construct session key from telegram_group
if [ -n "$TELEGRAM_GROUP" ]; then
    case "$TELEGRAM_GROUP" in
        -*)  SESSION_KEY="agent:main:telegram:group:${TELEGRAM_GROUP}" ;;
        *)   SESSION_KEY="agent:main:telegram:dm:${TELEGRAM_GROUP}" ;;
    esac
    INJECT_TEXT="[Claude Code 任务完成] 任务 '${TASK_NAME}' 已完成。请用 nodes 工具读取 Mac Mini 上的 /Users/fangjin/claude-code-results/latest.json 获取结果详情，然后向用户汇报完成情况。"
    /opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "$INJECT_TEXT" "$SESSION_KEY" \\
        > /dev/null 2>&1 \\
        && log "Chat inject sent to $SESSION_KEY" \\
        || log "Chat inject failed (non-fatal)"
else
    log "No telegram_group, skipping inject"
fi'''
    new_lines = lines[:inject_start] + new_section.split('\n') + lines[inject_end+1:]
    hook = '\n'.join(new_lines)
    with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'w') as f:
        f.write(hook)
    print("[2/2] Hook updated: chat.inject with sessionKey")
else:
    print(f"[2/2] WARNING: Could not find inject section (start={inject_start}, end={inject_end})")

# 3. Test inject with sessionKey
stdin, stdout, stderr = client.exec_command(
    '/opt/homebrew/bin/node /Users/fangjin/claude-code-inject.js "[测试] Claude Code 任务完成通知" "agent:main:telegram:dm:6564284621" 2>&1'
)
time.sleep(12)
result = stdout.read().decode().strip()
print(f"\nInject test: {result}")

sftp.close()
client.close()
