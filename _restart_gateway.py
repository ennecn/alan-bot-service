#!/usr/bin/env python3
import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:$PATH && {cmd}'
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8','replace'), stderr.read().decode('utf-8','replace')

# Find PID
out, err = run('lsof -i :8080 -t')
pids = out.strip()
print(f'PIDs on port 8080: {pids}')

if pids:
    for pid in pids.split('\n'):
        pid = pid.strip()
        if pid:
            print(f'  Killing PID {pid}...')
            run(f'kill -9 {pid}')
    time.sleep(2)

# Check plist
out, err = run('ls -la ~/Library/LaunchAgents/com.llm-gateway-v2*')
print(f'Plist files: {out.strip()}')

out, err = run('cat ~/Library/LaunchAgents/com.llm-gateway-v2.plist')
print(f'Plist:\n{out.strip()[:800]}')

# Try launchctl
uid_out, _ = run('id -u')
uid = uid_out.strip()
print(f'UID: {uid}')

out, err = run(f'launchctl bootout gui/{uid} ~/Library/LaunchAgents/com.llm-gateway-v2.plist 2>&1 || true')
print(f'Bootout: {out.strip()} {err.strip()}')
time.sleep(1)

out, err = run(f'launchctl bootstrap gui/{uid} ~/Library/LaunchAgents/com.llm-gateway-v2.plist 2>&1')
print(f'Bootstrap: {out.strip()} {err.strip()}')
time.sleep(3)

# Check health
out, err = run('curl -s http://127.0.0.1:8080/health')
print(f'Health: {out.strip()}')

# If health fails, try direct start
if 'ok' not in out:
    print('Service not started via launchctl, trying direct node start...')
    # Start in background
    run('cd /Users/fangjin/llm-gateway-v2 && nohup node server.js > /tmp/gateway-v2.log 2>&1 &')
    time.sleep(3)
    out, err = run('curl -s http://127.0.0.1:8080/health')
    print(f'Health after direct start: {out.strip()}')
    out, err = run('tail -20 /tmp/gateway-v2.log')
    print(f'Log:\n{out.strip()}')

out, err = run('curl -s http://127.0.0.1:8080/api/bots')
print(f'Bots API: {out.strip()[:500]}')

client.close()
print('\nDone!')
