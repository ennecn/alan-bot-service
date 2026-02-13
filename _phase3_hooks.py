#!/usr/bin/env python3
"""Phase 3: Create Claude Code hooks and dispatch script on Mac Mini."""
import paramiko, sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH'

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    try:
        _, stdout, stderr = c.exec_command(f'{PATH} && {cmd}', timeout=timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f'TIMEOUT: {e}', ''

sftp = c.open_sftp()

# ============================================================
# Step 1: Create hook directory
# ============================================================
print('=== Step 1: Create hook directory ===', flush=True)
run('mkdir -p /Users/fangjin/.claude/hooks')
print('  Done', flush=True)

# ============================================================
# Step 2: Create notify-openclaw.sh hook script
# ============================================================
print('\n=== Step 2: Create notify-openclaw.sh ===', flush=True)

HOOK_SCRIPT = r'''#!/bin/bash
# Claude Code Hook: Notify OpenClaw when Claude Code finishes.
# Reads session info from stdin, writes latest.json, wakes Alin gateway.

export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH

RESULTS_DIR="/Users/fangjin/claude-code-results"
LOCK_FILE="/tmp/openclaw-notify.lock"
GATEWAY_URL="http://127.0.0.1:18789/api/cron/wake"
GATEWAY_TOKEN="mysecrettoken123"

# ---- read stdin (JSON with session_id, cwd, event) ----
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null)
EVENT=$(echo "$INPUT" | jq -r '.event // "unknown"' 2>/dev/null)

# ---- prevent duplicate notifications (30s lock) ----
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE") ))
    if [ "$LOCK_AGE" -lt 30 ]; then
        exit 0
    fi
fi
touch "$LOCK_FILE"

# ---- collect task output ----
TASK_OUTPUT=""
if [ -f "$CWD/task-output.txt" ]; then
    TASK_OUTPUT=$(tail -100 "$CWD/task-output.txt" 2>/dev/null)
fi

# ---- collect task meta ----
TASK_NAME="unknown"
TASK_PROMPT=""
if [ -f "$CWD/task-meta.json" ]; then
    TASK_NAME=$(jq -r '.name // "unknown"' "$CWD/task-meta.json" 2>/dev/null)
    TASK_PROMPT=$(jq -r '.prompt // ""' "$CWD/task-meta.json" 2>/dev/null)
fi

# ---- write latest.json ----
mkdir -p "$RESULTS_DIR"
RESULT_FILE="$RESULTS_DIR/latest.json"

jq -n \
    --arg session_id "$SESSION_ID" \
    --arg cwd "$CWD" \
    --arg event "$EVENT" \
    --arg task_name "$TASK_NAME" \
    --arg task_prompt "$TASK_PROMPT" \
    --arg output "$TASK_OUTPUT" \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
        session_id: $session_id,
        cwd: $cwd,
        event: $event,
        task_name: $task_name,
        task_prompt: $task_prompt,
        output: $output,
        timestamp: $timestamp,
        status: "completed"
    }' > "$RESULT_FILE"

# ---- wake Alin gateway ----
curl -s -X POST "$GATEWAY_URL" \
    -H "Authorization: Bearer $GATEWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"source":"claude-code-hook","event":"'"$EVENT"'"}' \
    --max-time 5 \
    > /dev/null 2>&1 || true

exit 0
'''

with sftp.file('/Users/fangjin/.claude/hooks/notify-openclaw.sh', 'w') as f:
    f.write(HOOK_SCRIPT)
run('chmod +x /Users/fangjin/.claude/hooks/notify-openclaw.sh')
print('  Written and made executable', flush=True)

# Verify
out, _ = run('head -5 /Users/fangjin/.claude/hooks/notify-openclaw.sh')
print(f'  First 5 lines: {out.strip()[:200]}', flush=True)

# ============================================================
# Step 3: Register hooks in Claude Code settings.json
# ============================================================
print('\n=== Step 3: Register hooks in settings.json ===', flush=True)

# Read existing settings
out, _ = run('cat /Users/fangjin/.claude/settings.json 2>/dev/null || echo "{}"')
try:
    settings = json.loads(out.strip())
except json.JSONDecodeError:
    settings = {}

print(f'  Existing settings: {json.dumps(settings, indent=2)[:300]}', flush=True)

# Add hooks
settings['hooks'] = {
    'Stop': [{
        'hooks': [{
            'type': 'command',
            'command': '/Users/fangjin/.claude/hooks/notify-openclaw.sh',
            'timeout': 10
        }]
    }],
    'SessionEnd': [{
        'hooks': [{
            'type': 'command',
            'command': '/Users/fangjin/.claude/hooks/notify-openclaw.sh',
            'timeout': 10
        }]
    }]
}

with sftp.file('/Users/fangjin/.claude/settings.json', 'w') as f:
    f.write(json.dumps(settings, indent=2))

print(f'  Updated settings: {json.dumps(settings, indent=2)[:500]}', flush=True)

# ============================================================
# Step 4: Create dispatch script
# ============================================================
print('\n=== Step 4: Create dispatch script ===', flush=True)

DISPATCH_SCRIPT = r'''#!/bin/bash
# claude-code-dispatch.sh - Dispatch a task to Claude Code
# Usage: claude-code-dispatch.sh -p "prompt" [-n name] [-w workdir]
#
# Runs Claude Code in background and returns immediately.
# Results will be written to /Users/fangjin/claude-code-results/latest.json
# by the notify-openclaw.sh hook when Claude Code completes.

export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH

PROMPT=""
TASK_NAME="task-$(date +%s)"
WORKDIR="/Users/fangjin/claude-workspace/alin"
MAX_TURNS=20

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        -w|--workdir) WORKDIR="$2"; shift 2;;
        -t|--max-turns) MAX_TURNS="$2"; shift 2;;
        *) shift;;
    esac
done

if [ -z "$PROMPT" ]; then
    echo '{"error": "prompt required (-p \"your prompt\")"}'
    exit 1
fi

# Ensure work dir exists
mkdir -p "$WORKDIR"

# Write task meta
cat > "$WORKDIR/task-meta.json" << TMEOF
{
    "name": "$TASK_NAME",
    "prompt": $(echo "$PROMPT" | jq -Rs .),
    "workdir": "$WORKDIR",
    "max_turns": $MAX_TURNS,
    "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
TMEOF

# Run Claude Code in background
# Output is tee'd to task-output.txt so the hook can read it
nohup bash -c "
    cd \"$WORKDIR\" && \
    /opt/homebrew/bin/claude -p $(echo "$PROMPT" | jq -Rs .) \
        --max-turns $MAX_TURNS \
        --output-format json \
        --dangerously-skip-permissions \
        2>&1 | tee \"$WORKDIR/task-output.txt\"
" > /dev/null 2>&1 &

CLAUDE_PID=$!

# Return immediately with dispatch info
cat << EOF
{
    "status": "dispatched",
    "task_name": "$TASK_NAME",
    "workdir": "$WORKDIR",
    "pid": $CLAUDE_PID,
    "max_turns": $MAX_TURNS,
    "message": "Claude Code is running in background. Results will be written to /Users/fangjin/claude-code-results/latest.json when complete."
}
EOF
'''

with sftp.file('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(DISPATCH_SCRIPT)
run('chmod +x /Users/fangjin/claude-code-dispatch.sh')
print('  Dispatch script created', flush=True)

# Verify
out, _ = run('head -10 /Users/fangjin/claude-code-dispatch.sh')
print(f'  First 10 lines:\n{out.strip()[:400]}', flush=True)

# ============================================================
# Step 5: Test dispatch script (dry run)
# ============================================================
print('\n=== Step 5: Verify files ===', flush=True)
out, _ = run('ls -la /Users/fangjin/.claude/hooks/notify-openclaw.sh /Users/fangjin/claude-code-dispatch.sh /Users/fangjin/.claude/settings.json')
print(out.strip(), flush=True)

out, _ = run('cat /Users/fangjin/.claude/settings.json')
print(f'\n  settings.json:\n{out.strip()[:600]}', flush=True)

sftp.close()
c.close()
print('\nPhase 3 complete!', flush=True)
