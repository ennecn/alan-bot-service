#!/usr/bin/env python3
"""Port PTY/workspace trust handling from claude_code_run.py reference into dispatch scripts"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# ============================================================
# 1. Updated dispatch script with permission-mode support
# ============================================================
dispatch_sh = r'''#!/bin/bash
# claude-code-dispatch.sh v2.1 - Dispatch Claude Code task in tmux session
# Ported: script(1) PTY, workspace trust, permission-mode from claude_code_run.py
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH

PROMPT=""
TASK_NAME="task-$(date +%s)"
WORKDIR="/Users/fangjin/claude-workspace/alin"
MAX_TURNS=50
TELEGRAM_GROUP=""
PERMISSION_MODE=""
TMUX=/opt/homebrew/bin/tmux
JQ=/usr/bin/jq
CLAUDE=/opt/homebrew/bin/claude

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--prompt) PROMPT="$2"; shift 2;;
        -n|--name) TASK_NAME="$2"; shift 2;;
        -w|--workdir) WORKDIR="$2"; shift 2;;
        -t|--max-turns) MAX_TURNS="$2"; shift 2;;
        -g|--group) TELEGRAM_GROUP="$2"; shift 2;;
        -m|--permission-mode) PERMISSION_MODE="$2"; shift 2;;
        *) shift;;
    esac
done

if [ -z "$PROMPT" ]; then
    echo '{"error": "prompt required (-p \"your prompt\")"}'
    exit 1
fi

SESSION_NAME="cc-${TASK_NAME}"
RESULTS_DIR="/Users/fangjin/claude-code-results"

$TMUX kill-session -t "$SESSION_NAME" 2>/dev/null
mkdir -p "$WORKDIR" "$RESULTS_DIR"

# Write task meta (hook reads this for telegram_group)
$JQ -n \
    --arg name "$TASK_NAME" \
    --arg session "$SESSION_NAME" \
    --arg prompt "$PROMPT" \
    --arg workdir "$WORKDIR" \
    --argjson max_turns "$MAX_TURNS" \
    --arg group "$TELEGRAM_GROUP" \
    --arg perm "$PERMISSION_MODE" \
    --arg started "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{name: $name, session: $session, prompt: $prompt, workdir: $workdir, max_turns: $max_turns, telegram_group: $group, permission_mode: $perm, started_at: $started}' \
    > "$WORKDIR/task-meta.json"

# Also copy to results dir (hook checks both locations)
cp "$WORKDIR/task-meta.json" "$RESULTS_DIR/task-meta.json"

# Write prompt to file
PROMPT_FILE="$WORKDIR/.task-prompt.txt"
echo "$PROMPT" > "$PROMPT_FILE"

# Write runner script
RUNNER_FILE="$WORKDIR/.task-runner.sh"
cat > "$RUNNER_FILE" << 'RUNEOF'
#!/bin/bash
# Task runner v2.1 - runs inside tmux session
# Features: script(1) PTY, workspace trust, permission-mode
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT_FILE="$1"
WORKDIR="$2"
MAX_TURNS="$3"
RESULTS_DIR="$4"
TASK_NAME="$5"
PERMISSION_MODE="$6"

PROMPT=$(cat "$PROMPT_FILE")
CLAUDE=/opt/homebrew/bin/claude
JQ=/usr/bin/jq

cd "$WORKDIR"

echo "========================================================"
echo "  Claude Code Task: $TASK_NAME"
echo "  Max Turns: $MAX_TURNS | Workdir: $WORKDIR"
echo "  Permission: ${PERMISSION_MODE:-dangerously-skip-permissions}"
echo "  Started: $(date)"
echo "========================================================"
echo ""

# ---- Build claude command ----
CLAUDE_CMD="$CLAUDE -p \"$PROMPT\" --max-turns $MAX_TURNS --verbose"

if [ -n "$PERMISSION_MODE" ]; then
    # Use granular permission mode (plan, acceptEdits, default, etc.)
    CLAUDE_CMD="$CLAUDE_CMD --permission-mode $PERMISSION_MODE"
else
    # Default: skip all permissions (including workspace trust)
    CLAUDE_CMD="$CLAUDE_CMD --dangerously-skip-permissions"
fi

# ---- Run with script(1) for proper PTY allocation ----
# script(1) forces a pseudo-terminal even in non-interactive environments.
# This prevents Claude Code from hanging when it expects a TTY.
# On macOS: script -q /dev/null <command>
if [ -x /usr/bin/script ]; then
    echo "[runner] Using script(1) for PTY allocation"
    /usr/bin/script -q /dev/null bash -c "$CLAUDE_CMD 2>&1 | tee \"$WORKDIR/task-output.txt\""
    EXIT_CODE=${PIPESTATUS[0]:-$?}
else
    echo "[runner] script(1) not found, running directly"
    eval "$CLAUDE_CMD" 2>&1 | tee "$WORKDIR/task-output.txt"
    EXIT_CODE=${PIPESTATUS[0]:-$?}
fi

echo ""
echo "========================================================"
echo "  TASK COMPLETE (exit: $EXIT_CODE) at $(date)"
echo "========================================================"

# Write completion result (hook also writes, this is backup)
$JQ -n \
    --arg task_name "$TASK_NAME" \
    --arg workdir "$WORKDIR" \
    --argjson exit_code "$EXIT_CODE" \
    --arg completed_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{task_name: $task_name, workdir: $workdir, exit_code: $exit_code, completed_at: $completed_at, status: "completed"}' \
    > "$RESULTS_DIR/latest.json"

echo "Session stays alive 10min. Attach: tmux attach -t cc-$TASK_NAME"
sleep 600
RUNEOF
chmod +x "$RUNNER_FILE"

# Create tmux session
$TMUX new-session -d -s "$SESSION_NAME" -c "$WORKDIR" \
    "$RUNNER_FILE $PROMPT_FILE $WORKDIR $MAX_TURNS $RESULTS_DIR $TASK_NAME $PERMISSION_MODE"

if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    $JQ -n \
        --arg status "dispatched" \
        --arg task_name "$TASK_NAME" \
        --arg session "$SESSION_NAME" \
        --arg workdir "$WORKDIR" \
        --argjson max_turns "$MAX_TURNS" \
        --arg group "$TELEGRAM_GROUP" \
        --arg perm "${PERMISSION_MODE:-dangerously-skip-permissions}" \
        '{status: $status, task_name: $task_name, session: $session, workdir: $workdir, max_turns: $max_turns, telegram_group: $group, permission_mode: $perm}'
else
    echo '{"error": "Failed to create tmux session"}'
    exit 1
fi
'''

with sftp.file('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
    f.write(dispatch_sh)
stdin, stdout, stderr = client.exec_command('chmod +x /Users/fangjin/claude-code-dispatch.sh')
stdout.read()
print("[1/2] claude-code-dispatch.sh v2.1 deployed (script(1) PTY + permission-mode)")

# ============================================================
# 2. Workspace trust helper - pre-trust new directories
# ============================================================
trust_sh = r'''#!/bin/bash
# claude-code-trust.sh - Pre-trust a workspace directory for Claude Code
# Creates the project config directory so Claude Code doesn't prompt for trust
# Usage: claude-code-trust.sh /path/to/workspace

WORKSPACE="${1:-.}"
WORKSPACE=$(cd "$WORKSPACE" 2>/dev/null && pwd || echo "$WORKSPACE")

# Claude Code stores project configs in ~/.claude/projects/ with path-encoded names
# e.g., /Users/fangjin/myproject -> -Users-fangjin-myproject
ENCODED=$(echo "$WORKSPACE" | sed 's|/|-|g')
PROJECT_DIR="$HOME/.claude/projects/${ENCODED}"

if [ -d "$PROJECT_DIR" ]; then
    echo "{\"status\": \"already_trusted\", \"workspace\": \"$WORKSPACE\", \"project_dir\": \"$PROJECT_DIR\"}"
else
    mkdir -p "$PROJECT_DIR"
    # Create minimal settings to mark as trusted
    echo '{}' > "$PROJECT_DIR/settings.json"
    echo "{\"status\": \"trusted\", \"workspace\": \"$WORKSPACE\", \"project_dir\": \"$PROJECT_DIR\"}"
fi
'''

with sftp.file('/Users/fangjin/claude-code-trust.sh', 'w') as f:
    f.write(trust_sh)
stdin, stdout, stderr = client.exec_command('chmod +x /Users/fangjin/claude-code-trust.sh')
stdout.read()
print("[2/2] claude-code-trust.sh deployed (workspace trust helper)")

# ============================================================
# 3. Verify
# ============================================================
print("\n--- Verification ---")

# Check dispatch has script(1) reference
stdin, stdout, stderr = client.exec_command('grep -c "script(1)" /Users/fangjin/claude-code-dispatch.sh')
count = stdout.read().decode().strip()
print(f"dispatch.sh script(1) references: {count}")

# Check dispatch has permission-mode
stdin, stdout, stderr = client.exec_command('grep -c "permission-mode" /Users/fangjin/claude-code-dispatch.sh')
count = stdout.read().decode().strip()
print(f"dispatch.sh permission-mode references: {count}")

# Check trust helper
stdin, stdout, stderr = client.exec_command('/Users/fangjin/claude-code-trust.sh /Users/fangjin/claude-workspace/alin')
print(f"Trust test: {stdout.read().decode().strip()}")

sftp.close()
client.close()
print("\nDone!")
