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

# Test openclaw message send directly
print("=== Test 1: openclaw message send with verbose ===")
out, code = run('export PATH=/opt/homebrew/bin:$PATH OPENCLAW_GATEWAY_TOKEN=mysecrettoken123 OPENCLAW_GATEWAY=http://127.0.0.1:18789 && /opt/homebrew/bin/openclaw message send --channel telegram --target "6564284621" --message "Hook test from Mac Mini" --verbose 2>&1', timeout=15)
print(f"[EXIT] {code}")
print(f"[OUT] {out}")

print("\n=== Test 2: with --json flag ===")
out, code = run('OPENCLAW_GATEWAY_TOKEN=mysecrettoken123 OPENCLAW_GATEWAY=http://127.0.0.1:18789 /opt/homebrew/bin/openclaw message send --channel telegram --target "6564284621" --message "Test 2" --json 2>&1', timeout=15)
print(f"[EXIT] {code}")
print(f"[OUT] {out}")

print("\n=== Test 3: check openclaw config ===")
out, _ = run('cat /Users/fangjin/.openclaw/openclaw.json 2>/dev/null | head -20', timeout=5)
print(f"[CONFIG] {out}")

print("\n=== Test 4: openclaw health ===")
out, _ = run('OPENCLAW_GATEWAY_TOKEN=mysecrettoken123 /opt/homebrew/bin/openclaw health --json 2>&1', timeout=10)
print(f"[HEALTH] {out}")

client.close()
