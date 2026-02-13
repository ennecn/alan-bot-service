import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

content = run('cat /Users/fangjin/llm-gateway/router.js')
lines = content.split('\n')

# Show lines 447-470 to see the full header building for non-OpenAI (Antigravity)
print("=== Header building for Anthropic-format providers (L447-470) ===")
for i in range(446, min(475, len(lines))):
    print(f"  L{i+1}: {lines[i].rstrip()}")

mac.close()
