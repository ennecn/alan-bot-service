import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd)
    return stdout.read().decode('utf-8', errors='replace').strip()

# 1. Check router.js for how requests are forwarded to Antigravity
print("=== router.js - request forwarding logic ===")
router = run('cat /Users/fangjin/llm-gateway/router.js')
print(f"Total lines: {len(router.split(chr(10)))}")

# Find relevant sections
for i, line in enumerate(router.split('\n'), 1):
    lower = line.lower()
    if any(kw in lower for kw in ['effortlevel', 'effort', 'generation_config', 'sanitize', 'strip', 'clean', 'forward', 'antigravity', 'body', 'requestbody', 'anthropic.*format']):
        print(f"  L{i}: {line.rstrip()}")

# 2. Print the full function that handles forwarding
print("\n=== router.js - full content ===")
print(router)

mac.close()
