#!/usr/bin/env python3
import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Clean up first
cmd_cleanup = "rm -f /tmp/claude-runner-* /tmp/claude-prompt-* /Users/fangjin/claude-workspace/alin/task-output.txt /Users/fangjin/claude-code-results/latest.json /tmp/openclaw-notify.lock"
stdin, stdout, stderr = client.exec_command(cmd_cleanup)
stdout.read()

# Test: run the runner script directly (not through dispatch)
# First create the prompt and runner files manually
cmd_setup = """
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH

# Create prompt file
echo "Reply with just: RUNNER_TEST_OK" > /tmp/test-prompt.txt

# Create runner script
cat > /tmp/test-runner.sh << 'RUNEOF'
#!/bin/bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/lib/node_modules/.bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

PROMPT_FILE="$1"
WORKDIR="$2"
MAX_TURNS="$3"

PROMPT=$(cat "$PROMPT_FILE")
rm -f "$PROMPT_FILE"

cd "$WORKDIR" && \
/opt/homebrew/bin/claude -p "$PROMPT" \
    --max-turns "$MAX_TURNS" \
    --output-format json \
    --dangerously-skip-permissions \
    2>&1 | tee "$WORKDIR/task-output.txt"

rm -f "$0"
RUNEOF
chmod +x /tmp/test-runner.sh

echo "=== Files created ==="
ls -la /tmp/test-prompt.txt /tmp/test-runner.sh

echo "=== Running runner directly (foreground) ==="
/tmp/test-runner.sh /tmp/test-prompt.txt /Users/fangjin/claude-workspace/alin 1
echo "RUNNER_EXIT=$?"
"""

channel = client.get_transport().open_session()
channel.get_pty()
channel.exec_command(cmd_setup)

output = b""
start = time.time()
while time.time() - start < 60:
    if channel.recv_ready():
        chunk = channel.recv(4096)
        if not chunk:
            break
        output += chunk
        print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
    elif channel.exit_status_ready():
        while channel.recv_ready():
            output += channel.recv(4096)
        break
    else:
        time.sleep(0.3)

print("\n\n=== Checking task-output.txt ===")
stdin, stdout, stderr = client.exec_command('cat /Users/fangjin/claude-workspace/alin/task-output.txt 2>/dev/null | head -5')
print(stdout.read().decode())

channel.close()
client.close()
