#!/usr/bin/env python3
import paramiko
import time
import select

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmd = 'export PATH=/opt/homebrew/bin:/opt/homebrew/lib/node_modules/.bin:$PATH && claude -p "Say hello and confirm you are working. Reply in one short sentence." --max-turns 1 --output-format text 2>&1; echo "EXIT_CODE=$?"'

print("[TEST] Running Claude Code with PTY...")

# Use invoke_shell for PTY
channel = client.get_transport().open_session()
channel.get_pty()
channel.exec_command(cmd)

output = b""
start = time.time()
timeout = 120  # 2 minutes

while time.time() - start < timeout:
    if channel.recv_ready():
        chunk = channel.recv(4096)
        if not chunk:
            break
        output += chunk
        decoded = chunk.decode('utf-8', errors='replace')
        # Print chunks as they arrive
        print(decoded, end='', flush=True)
    elif channel.exit_status_ready():
        # Drain remaining
        while channel.recv_ready():
            output += channel.recv(4096)
        break
    else:
        time.sleep(0.5)

exit_code = channel.recv_exit_status()
print(f"\n\n[EXIT CODE] {exit_code}")

full_output = output.decode('utf-8', errors='replace')
if "EXIT_CODE=0" in full_output and len(full_output.strip()) > 20:
    print("[PASS] Claude Code is working!")
else:
    print("[NEEDS REVIEW] Check output above")

channel.close()
client.close()
