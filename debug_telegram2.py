#!/usr/bin/env python3
import paramiko, time, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    channel = client.get_transport().open_session()
    channel.get_pty()
    channel.settimeout(timeout)
    channel.exec_command(cmd)
    out = b""
    start = time.time()
    while time.time() - start < timeout:
        if channel.recv_ready():
            chunk = channel.recv(4096)
            if not chunk: break
            out += chunk
        elif channel.exit_status_ready():
            while channel.recv_ready():
                out += channel.recv(4096)
            break
        else:
            time.sleep(0.3)
    code = channel.recv_exit_status()
    channel.close()
    text = out.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[^m]*m|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', text)
    return text.strip(), code

# Test 1: docker exec openclaw message send
print("=== Test 1: docker exec message send ===")
out, code = run('docker exec deploy-openclaw-gateway-1 openclaw message send --channel telegram --target "6564284621" --message "Hook test via docker exec" --json 2>&1', timeout=15)
print(f"[EXIT] {code}")
print(f"[OUT] {out}")

# Test 2: Check gateway API for message endpoint
print("\n=== Test 2: Gateway API endpoints ===")
out, _ = run('curl -s http://127.0.0.1:18789/api/ 2>&1 | head -20', timeout=5)
print(f"[API] {out}")

# Test 3: Try gateway message API
print("\n=== Test 3: Gateway message send API ===")
out, _ = run("""curl -s -X POST http://127.0.0.1:18789/api/message/send \
    -H 'Authorization: Bearer mysecrettoken123' \
    -H 'Content-Type: application/json' \
    -d '{"channel":"telegram","target":"6564284621","message":"Hook test via API"}' 2>&1""", timeout=10)
print(f"[API MSG] {out}")

# Test 4: Try /api/channels to see what's available
print("\n=== Test 4: Available channels ===")
out, _ = run('curl -s http://127.0.0.1:18789/api/channels -H "Authorization: Bearer mysecrettoken123" 2>&1 | head -30', timeout=5)
print(f"[CHANNELS] {out}")

client.close()
