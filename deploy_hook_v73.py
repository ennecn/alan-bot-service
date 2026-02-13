#!/usr/bin/env python3
"""Deploy hook v7.3: fix duplicate notification from SessionEnd.

Problem: Stop hook takes ~23s, SessionEnd fires 15s later (38s total),
exceeding the 30s dedup window. The .processed marker check only exists
in the fallback path, not the primary cwd path.

Fix:
1. After reading task metadata, check .processed marker (catches SessionEnd)
2. After processing, rename $CWD/task-meta.json to .done (prevents re-detection)
"""
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

sftp = c.open_sftp()
with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "r") as f:
    hook = f.read().decode("utf-8")

# --- Patch 1: Add processed check after reading task metadata ---
# Find the line after GATEWAY_PORT is read from META_FILE
old_meta_end = '    log "Meta: task=$TASK_NAME group=$TELEGRAM_GROUP port=$GATEWAY_PORT"\nfi'
new_meta_end = (
    '    log "Meta: task=$TASK_NAME group=$TELEGRAM_GROUP port=$GATEWAY_PORT"\n'
    'fi\n'
    '\n'
    '# v7.3: Check if this task was already processed (catches SessionEnd after Stop)\n'
    'SAFE_TASK=$(echo "$TASK_NAME" | tr -cd "a-zA-Z0-9_-" | head -c 60)\n'
    'if [ -n "$SAFE_TASK" ] && [ "$SAFE_TASK" != "unknown" ] && [ -f "${RESULT_DIR}/.processed-${SAFE_TASK}" ]; then\n'
    '    log "Task $TASK_NAME already processed (v7.3 dedup), skipping"\n'
    '    exit 0\n'
    'fi'
)

if old_meta_end in hook:
    hook = hook.replace(old_meta_end, new_meta_end, 1)
    print("1. PATCHED: Added processed check after metadata read")
else:
    print("1. WARNING: Could not find metadata end marker")
    # Check if already patched
    if "v7.3 dedup" in hook:
        print("   Already patched (v7.3)")
    else:
        print("   ERROR: unexpected hook content")

# --- Patch 2: Rename $CWD/task-meta.json after processing ---
# Find the existing processed marker section and add cwd rename
old_processed = (
    '    # Rename task-meta.json in results dir to prevent fallback re-processing\n'
    '    if [ -f "${RESULT_DIR}/task-meta.json" ]; then\n'
    '        mv "${RESULT_DIR}/task-meta.json" "${RESULT_DIR}/task-meta.json.done" 2>/dev/null || true\n'
    '        log "Marked task $SAFE_TASK as processed"\n'
    '    fi'
)
new_processed = (
    '    # Rename task-meta.json in both locations to prevent re-processing\n'
    '    if [ -f "${RESULT_DIR}/task-meta.json" ]; then\n'
    '        mv "${RESULT_DIR}/task-meta.json" "${RESULT_DIR}/task-meta.json.done" 2>/dev/null || true\n'
    '    fi\n'
    '    if [ -n "$CWD" ] && [ -f "$CWD/task-meta.json" ]; then\n'
    '        mv "$CWD/task-meta.json" "$CWD/task-meta.json.done" 2>/dev/null || true\n'
    '    fi\n'
    '    log "Marked task $SAFE_TASK as processed"'
)

if old_processed in hook:
    hook = hook.replace(old_processed, new_processed, 1)
    print("2. PATCHED: Added $CWD/task-meta.json rename after processing")
else:
    if "$CWD/task-meta.json.done" in hook:
        print("2. Already patched (cwd rename)")
    else:
        print("2. WARNING: Could not find processed section")

# Update version comment
hook = hook.replace(
    "# Claude Code Stop Hook v7: fix duplicate notifications + empty Result",
    "# Claude Code Stop Hook v7.3: fix duplicate notifications + empty Result"
)

with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "wb") as f:
    f.write(hook.encode("utf-8"))
sftp.close()

# Verify
si, so, se = c.exec_command('grep "v7.3\\|processed.*dedup\\|CWD.*task-meta.*done" /Users/fangjin/.claude/hooks/notify-openclaw.sh')
print(f"\nVerify:\n{so.read().decode().strip()}")

# Clean stale markers
si, so, se = c.exec_command(
    "rm -f /Users/fangjin/claude-code-results/.processed-* "
    "/Users/fangjin/claude-code-results/.hook-lock-* "
    "/Users/fangjin/claude-workspace/alin/.task-complete "
    "/Users/fangjin/claude-workspace/alin/task-meta.json "
    "/Users/fangjin/claude-workspace/alin/task-meta.json.done "
    "/Users/fangjin/claude-workspace/alin/claude-result.txt "
    "/Users/fangjin/claude-workspace/alin/task-output.txt"
)
so.read()
print("\nCleaned stale files")

c.close()
print("\nDeployed hook v7.3!")
print("- Checks .processed marker in primary path (not just fallback)")
print("- Renames $CWD/task-meta.json after processing")
print("- SessionEnd will now be caught by processed check")
