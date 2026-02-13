import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Run Claude Code directly on host with Gateway as backend
# Use --output-format json (not stream-json) for simpler parsing
print("=== Direct Claude Code test on host ===")
stdin, stdout, stderr = mac.exec_command(
    f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && '
    f'ANTHROPIC_API_KEY="gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    f'ANTHROPIC_BASE_URL="http://127.0.0.1:8080" '
    f'timeout 60 claude -p "What files are in this directory? List them." '
    f'--output-format json --dangerously-skip-permissions --max-budget-usd 0.05 '
    f'--verbose 2>/tmp/cc-stderr.log',
    timeout=90
)

out = stdout.read().decode('utf-8', errors='replace').strip()
err = stderr.read().decode('utf-8', errors='replace').strip()
print(f"stdout ({len(out)} chars):")
print(out[:3000])
if err:
    print(f"\nstderr: {err[:1000]}")

# Check stderr log
def run(cmd, timeout=15):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

print("\n=== Claude Code stderr ===")
print(run('cat /tmp/cc-stderr.log | tail -20'))

# Check Gateway log
print("\n=== Gateway logs ===")
print(run('tail -15 /tmp/gateway.log'))

mac.close()
print("\n[DONE]")
