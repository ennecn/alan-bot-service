import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Check how the Gateway forwards headers to Antigravity
# Read the exact header building code
content = run('cat /Users/fangjin/llm-gateway/router.js')
lines = content.split('\n')

print("=== Header building code (around L410-L445) ===")
for i in range(409, min(450, len(lines))):
    print(f"  L{i+1}: {lines[i].rstrip()}")

# Also check what headers OpenClaw sends
print("\n=== What does the api-proxy forward? ===")
proxy = run('export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH && docker exec deploy-openclaw-gateway-1 cat /home/node/api-proxy.js')
for line in proxy.split('\n'):
    if 'header' in line.lower() or 'anthropic' in line.lower() or 'beta' in line.lower():
        print(f"  {line.rstrip()}")

mac.close()
print("\n[DONE]")
