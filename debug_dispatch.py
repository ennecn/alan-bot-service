#!/usr/bin/env python3
import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Test 1: Run Claude Code directly with nohup (capture stderr)
cmd = """
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH
source ~/.bash_profile 2>/dev/null
source ~/.zshrc 2>/dev/null

echo "=== ENV CHECK ==="
echo "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
echo "ANTHROPIC_API_KEY set: $([ -n \"$ANTHROPIC_API_KEY\" ] && echo yes || echo no)"
echo "ANTHROPIC_AUTH_TOKEN set: $([ -n \"$ANTHROPIC_AUTH_TOKEN\" ] && echo yes || echo no)"
echo "claude path: $(which claude)"
echo "node path: $(which node)"

echo "=== DIRECT RUN (foreground, 30s timeout) ==="
timeout 60 /opt/homebrew/bin/claude -p "Reply with just: HOOK_TEST_OK" --max-turns 1 --output-format text 2>/tmp/claude-test-stderr.txt | tee /tmp/claude-test-stdout.txt
echo "EXIT=$?"

echo "=== STDERR ==="
cat /tmp/claude-test-stderr.txt 2>/dev/null

echo "=== NOHUP TEST ==="
nohup bash -c '
    source ~/.bash_profile 2>/dev/null
    source ~/.zshrc 2>/dev/null
    export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:$PATH
    cd /Users/fangjin/claude-workspace/alin
    /opt/homebrew/bin/claude -p "Reply with just: NOHUP_TEST_OK" --max-turns 1 --output-format text 2>&1 | tee /tmp/nohup-claude-output.txt
' > /tmp/nohup-claude-full.txt 2>&1 &
NPID=$!
echo "nohup PID: $NPID"

# Wait for it
sleep 30
echo "=== NOHUP OUTPUT ==="
cat /tmp/nohup-claude-full.txt 2>/dev/null
echo "=== NOHUP TEE OUTPUT ==="
cat /tmp/nohup-claude-output.txt 2>/dev/null
echo "=== NOHUP PROCESS ==="
ps -p $NPID -o pid,stat,command 2>/dev/null || echo "process exited"
"""

channel = client.get_transport().open_session()
channel.get_pty()
channel.exec_command(cmd)

output = b""
start = time.time()
while time.time() - start < 120:
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
        time.sleep(0.5)

channel.close()
client.close()
