#!/usr/bin/env python3
"""Deploy runner v3.1 + hook v7.2: fix timing issue with pipe + task-complete marker."""
import paramiko
import sys
import re

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

# ============================================================
# 1. Patch runner in dispatch script
# ============================================================
print("1. Patching runner in dispatch script...")
sftp = c.open_sftp()
with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "r") as f:
    dispatch = f.read().decode("utf-8")

# Replace the process substitution block with pipe-based approach
# Old: eval "$CLAUDE_CMD" > >(tee ...) 2> >(tee ... >&2)
# New: eval "$CLAUDE_CMD" 2>"task-output.txt" | tee "claude-result.txt"
old_marker = 'echo "[runner] Running with split output capture (v3)"'
new_runner_section = (
    'echo "[runner] Running with pipe-based output capture (v3.1)"\n'
    '\n'
    'eval "$CLAUDE_CMD" 2>"$WORKDIR/task-output.txt" | tee "$WORKDIR/claude-result.txt"\n'
    'EXIT_CODE=${PIPESTATUS[0]}\n'
    '\n'
    '# Copy result to results dir + write completion marker\n'
    'cp "$WORKDIR/claude-result.txt" "$RESULTS_DIR/claude-result.txt" 2>/dev/null\n'
    'touch "$WORKDIR/.task-complete"'
)

if old_marker in dispatch:
    # Find the block from the echo line to the cp line
    start = dispatch.index(old_marker)
    # Find the end: "cp "$WORKDIR/claude-result.txt" "$RESULTS_DIR/claude-result.txt" 2>/dev/null"
    end_marker = 'cp "$WORKDIR/claude-result.txt" "$RESULTS_DIR/claude-result.txt" 2>/dev/null'
    end = dispatch.index(end_marker, start) + len(end_marker)
    dispatch = dispatch[:start] + new_runner_section + dispatch[end:]
    print("   PATCHED runner v3 -> v3.1 (pipe-based)")
else:
    print("   WARNING: runner marker not found, checking for v3.1...")
    if "v3.1" in dispatch:
        print("   Already patched to v3.1")
    else:
        print("   ERROR: could not find runner block!")

with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "wb") as f:
    f.write(dispatch.encode("utf-8"))

si, so, se = c.exec_command('grep "PIPESTATUS\\|pipe-based\\|task-complete" /Users/fangjin/claude-code-dispatch.sh')
print(f"   Markers: {so.read().decode().strip()}")

# ============================================================
# 2. Patch hook: wait for .task-complete marker
# ============================================================
print("\n2. Patching hook to wait for .task-complete marker...")
with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "r") as f:
    hook = f.read().decode("utf-8")

# Find the clean result reading section and replace it
old_read_marker = "# Read CLEAN result (stdout captured by runner v3"
if old_read_marker in hook:
    start = hook.index(old_read_marker)
    # Find the end of this section (next section starts with "# Read task metadata")
    end_marker = "# Read task metadata"
    end = hook.index(end_marker, start)

    new_read = (
        '# Read CLEAN result (v7.2: wait for .task-complete marker from runner v3.1)\n'
        'CLEAN_RESULT=""\n'
        'if [ -n "$CWD" ]; then\n'
        '    # Wait up to 15s for runner to finish writing results\n'
        '    for _wait in $(seq 1 15); do\n'
        '        if [ -f "$CWD/.task-complete" ]; then\n'
        '            log "Task complete marker found (waited ${_wait}s)"\n'
        '            break\n'
        '        fi\n'
        '        sleep 1\n'
        '    done\n'
        '    if [ -f "$CWD/claude-result.txt" ] && [ -s "$CWD/claude-result.txt" ]; then\n'
        '        CLEAN_RESULT=$(cat "$CWD/claude-result.txt")\n'
        '        log "Clean result: ${#CLEAN_RESULT} chars from $CWD/claude-result.txt"\n'
        '    fi\n'
        'fi\n'
        '# Fallback to results dir only if cwd had nothing\n'
        'if [ -z "$CLEAN_RESULT" ]; then\n'
        '    if [ -f "${RESULT_DIR}/claude-result.txt" ] && [ -s "${RESULT_DIR}/claude-result.txt" ]; then\n'
        '        CLEAN_RESULT=$(cat "${RESULT_DIR}/claude-result.txt")\n'
        '        log "Clean result: ${#CLEAN_RESULT} chars from results dir (fallback)"\n'
        '    else\n'
        '        log "No claude-result.txt found"\n'
        '    fi\n'
        'fi\n'
        '\n'
    )

    hook = hook[:start] + new_read + hook[end:]
    print("   PATCHED hook read logic with .task-complete wait")
else:
    print("   ERROR: clean result section not found!")

# Reduce initial sleep back to 2 (marker wait handles timing)
hook = hook.replace("sleep 5\n", "sleep 2\n", 1)

with sftp.open("/Users/fangjin/.claude/hooks/notify-openclaw.sh", "wb") as f:
    f.write(hook.encode("utf-8"))
sftp.close()

si, so, se = c.exec_command('grep "task-complete\\|v7.2\\|waited" /Users/fangjin/.claude/hooks/notify-openclaw.sh | head -5')
print(f"   Markers: {so.read().decode().strip()}")
si, so, se = c.exec_command("wc -l /Users/fangjin/.claude/hooks/notify-openclaw.sh")
print(f"   Lines: {so.read().decode().strip()}")

# ============================================================
# 3. Clean up stale files
# ============================================================
print("\n3. Cleaning stale files...")
cleanup = (
    "rm -f /Users/fangjin/claude-code-results/claude-result.txt "
    "/Users/fangjin/claude-code-results/.processed-* "
    "/Users/fangjin/claude-code-results/.hook-lock-* "
    "/Users/fangjin/claude-code-results/task-meta.json.done "
    "/Users/fangjin/claude-workspace/alin/claude-result.txt "
    "/Users/fangjin/claude-workspace/alin/task-output.txt "
    "/Users/fangjin/claude-workspace/alin/task-meta.json "
    "/Users/fangjin/claude-workspace/alin/.task-complete"
)
si, so, se = c.exec_command(cleanup)
so.read()
print("   Done")

c.close()
print("\nDeployed! Runner v3.1 (pipe) + Hook v7.2 (.task-complete marker)")
print("- Runner uses pipe instead of process substitution (no flush timing issues)")
print("- Runner writes .task-complete marker after copying result")
print("- Hook waits up to 15s for .task-complete before reading result")
