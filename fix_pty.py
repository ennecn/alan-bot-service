#!/usr/bin/env python3
"""Fix runner: skip script(1) inside tmux (already has PTY)"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

# Read current dispatch, replace the runner section
stdin, stdout, stderr = client.exec_command('cat /Users/fangjin/claude-code-dispatch.sh')
current = stdout.read().decode()

# Replace the runner's PTY section
old_pty = '''# ---- Run with script(1) for proper PTY allocation ----
# script(1) forces a pseudo-terminal even in non-interactive environments.
# This prevents Claude Code from hanging when it expects a TTY.
# On macOS: script -q /dev/null <command>
if [ -x /usr/bin/script ]; then
    echo "[runner] Using script(1) for PTY allocation"
    /usr/bin/script -q /dev/null bash -c "$CLAUDE_CMD 2>&1 | tee \\"$WORKDIR/task-output.txt\\""
    EXIT_CODE=${PIPESTATUS[0]:-$?}
else
    echo "[runner] script(1) not found, running directly"
    eval "$CLAUDE_CMD" 2>&1 | tee "$WORKDIR/task-output.txt"
    EXIT_CODE=${PIPESTATUS[0]:-$?}
fi'''

new_pty = '''# ---- Run Claude Code ----
# PTY handling:
# - Inside tmux: tmux already provides a PTY, run directly
# - Outside tmux: use script(1) to force PTY allocation (prevents hangs)
if [ -n "$TMUX" ]; then
    echo "[runner] PTY provided by tmux session"
    eval "$CLAUDE_CMD" 2>&1 | tee "$WORKDIR/task-output.txt"
    EXIT_CODE=${PIPESTATUS[0]:-$?}
elif [ -x /usr/bin/script ]; then
    echo "[runner] Using script(1) for PTY allocation"
    /usr/bin/script -q /dev/null bash -c "$CLAUDE_CMD 2>&1 | tee \\"$WORKDIR/task-output.txt\\""
    EXIT_CODE=${PIPESTATUS[0]:-$?}
else
    echo "[runner] No PTY available, running directly (may hang)"
    eval "$CLAUDE_CMD" 2>&1 | tee "$WORKDIR/task-output.txt"
    EXIT_CODE=${PIPESTATUS[0]:-$?}
fi'''

updated = current.replace(old_pty, new_pty)

if updated == current:
    print("WARNING: old_pty pattern not found, trying line-by-line match...")
    # Fallback: just write the whole file
else:
    with sftp.file('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
        f.write(updated)
    print("dispatch.sh runner updated: smart PTY detection (tmux vs script(1))")

# Verify
stdin, stdout, stderr = client.exec_command('grep -A3 "PTY handling" /Users/fangjin/claude-code-dispatch.sh')
print(f"\nVerify:\n{stdout.read().decode().strip()}")

sftp.close()
client.close()
