#!/usr/bin/env python3
import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Test specific flags that dispatch uses
cmd = """
export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH
source ~/.zshrc 2>/dev/null

echo "=== TEST 1: --output-format json ==="
/opt/homebrew/bin/claude -p "Reply: OK" --max-turns 1 --output-format json 2>/tmp/t1-err.txt | head -5
echo "T1_EXIT=$?"
echo "T1_STDERR=$(cat /tmp/t1-err.txt 2>/dev/null)"

echo ""
echo "=== TEST 2: --dangerously-skip-permissions ==="
/opt/homebrew/bin/claude -p "Reply: OK" --max-turns 1 --dangerously-skip-permissions 2>/tmp/t2-err.txt | head -5
echo "T2_EXIT=$?"
echo "T2_STDERR=$(cat /tmp/t2-err.txt 2>/dev/null)"

echo ""
echo "=== TEST 3: both flags ==="
/opt/homebrew/bin/claude -p "Reply: OK" --max-turns 1 --output-format json --dangerously-skip-permissions 2>/tmp/t3-err.txt | head -5
echo "T3_EXIT=$?"
echo "T3_STDERR=$(cat /tmp/t3-err.txt 2>/dev/null)"

echo ""
echo "=== TEST 4: nohup with both flags (like dispatch) ==="
rm -f /tmp/t4-output.txt /tmp/t4-full.txt
nohup bash -c '
    source ~/.zshrc 2>/dev/null
    export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:$PATH
    cd /Users/fangjin/claude-workspace/alin
    /opt/homebrew/bin/claude -p "Reply with just: DISPATCH_OK" \
        --max-turns 1 \
        --output-format json \
        --dangerously-skip-permissions \
        2>&1 | tee /tmp/t4-output.txt
' > /tmp/t4-full.txt 2>&1 &
T4PID=$!
echo "T4 PID: $T4PID"

# Wait up to 60s
for i in $(seq 1 12); do
    sleep 5
    if [ -s /tmp/t4-output.txt ]; then
        echo "T4 output found after ${i}x5s"
        break
    fi
    if ! ps -p $T4PID > /dev/null 2>&1; then
        echo "T4 process exited after ${i}x5s"
        break
    fi
    echo "  waiting... (${i}x5s)"
done

echo "=== T4 FULL ==="
cat /tmp/t4-full.txt 2>/dev/null | head -20
echo "=== T4 TEE ==="
cat /tmp/t4-output.txt 2>/dev/null | head -20
"""

channel = client.get_transport().open_session()
channel.get_pty()
channel.exec_command(cmd)

output = b""
start = time.time()
while time.time() - start < 180:
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
