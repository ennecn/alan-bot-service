import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=15):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Check sessions
print("=== Sessions ===")
print(run('curl -s http://127.0.0.1:9090/api/sessions'))

# Check session detail
print("\n=== Session detail ===")
print(run('curl -s http://127.0.0.1:9090/api/sessions/test-llm-gateway'))

# Check bridge logs (last 30 lines)
print("\n=== Bridge logs ===")
print(run('tail -30 /tmp/cc-bridge.log'))

# Check if claude process is running
PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
print("\n=== Claude processes ===")
print(run(f'{PATH_PREFIX} && ps aux | grep "claude.*print" | grep -v grep'))

mac.close()
