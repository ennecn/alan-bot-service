import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Check Gateway logs for the 404
print("=== Gateway logs (recent) ===")
print(run('tail -20 /tmp/gateway.log'))

# Also check what env vars Claude Code needs
print("\n=== Claude Code expected env vars ===")
PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'
print(run(f'{PATH_PREFIX} && claude --help 2>&1 | head -5'))

# Try direct test: what URL does Claude Code call?
# Run claude with debug to see the request
print("\n=== Test Claude Code directly on host with Gateway ===")
result = run(
    f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && '
    f'ANTHROPIC_API_KEY="gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    f'ANTHROPIC_BASE_URL="http://127.0.0.1:8080" '
    f'claude -p "Say hi" --output-format json --verbose --max-budget-usd 0.01 '
    f'--dangerously-skip-permissions 2>&1 | head -30',
    timeout=30
)
print(result[:2000])

# Check Gateway server.js for supported routes
print("\n=== Gateway routes ===")
routes = run("grep -n 'url\\|pathname\\|POST\\|GET\\|route' /Users/fangjin/llm-gateway/server.js | head -30")
print(routes)

mac.close()
