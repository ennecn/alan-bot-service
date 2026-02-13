import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

def run(cmd):
    stdin, stdout, stderr = client.exec_command(f'{PATH_PREFIX} && {cmd}')
    return stdout.read().decode('utf-8', errors='replace').strip()

containers = {
    'Alin': 'deploy-openclaw-gateway-1',
    'Lain': 'lain-gateway',
    'Lumi': 'lumi-gateway',
    'Aling': 'aling-gateway',
}

print("=== Container Status ===")
for bot, c in containers.items():
    status = run(f'docker inspect {c} --format "{{{{.State.Status}}}}" 2>/dev/null')
    print(f"  {bot} ({c}): {status}")

print("\n=== Health Checks (proxy -> Gateway) ===")
for bot, c in containers.items():
    health = run(f'docker exec {c} curl -s http://127.0.0.1:8022/health 2>/dev/null || echo "UNREACHABLE"')
    print(f"  {bot}: {health}")

print("\n=== Proxy Startup Logs ===")
for bot, c in containers.items():
    # Get only the proxy startup line
    logs = run(f'docker logs {c} 2>&1 | grep -E "\\[Proxy\\]" | tail -2')
    print(f"  {bot}: {logs if logs else '(no proxy log yet)'}")

print("\n=== Verify api-proxy.js content (Gateway client key) ===")
base = '/Users/fangjin/Desktop/p/docker-openclawd'
paths = {
    'Alin': f'{base}/deploy/api-proxy.js',
    'Lain': f'{base}/deploy-lain/api-proxy.js',
    'Lumi': f'{base}/deploy-lumi/api-proxy.js',
    'Aling': f'{base}/deploy-aling/api-proxy.js',
}
for bot, path in paths.items():
    key_line = run(f"grep 'CLIENT_API_KEY' {path}")
    print(f"  {bot}: {key_line}")

client.close()
print("\n[DONE]")
