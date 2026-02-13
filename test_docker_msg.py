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

# Find working docker path
for docker_path in ['/usr/local/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker']:
    out, code = run(f'{docker_path} ps --format "table {{{{.Names}}}}\\t{{{{.Status}}}}" 2>&1', timeout=10)
    print(f"[{docker_path}] exit={code}")
    print(out[:300])
    if code == 0:
        DOCKER = docker_path
        break
else:
    print("Docker not working!")
    client.close()
    exit(1)

print(f"\n=== Using docker at: {DOCKER} ===\n")

# Test message send via docker exec
out, code = run(f'{DOCKER} exec deploy-openclaw-gateway-1 openclaw message send --channel telegram --target "6564284621" --message "Hook test via docker exec" --json 2>&1', timeout=15)
print(f"[docker exec message send] exit={code}")
print(out[:500])

client.close()
