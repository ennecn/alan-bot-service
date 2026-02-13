import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    full_cmd = f'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" && {cmd}'
    stdin, stdout, stderr = mac.exec_command(full_cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# 1: Check getActualModel in router.js
print("=== getActualModel function ===")
out, _ = run("grep -n -A 30 'function getActualModel' /Users/fangjin/llm-gateway/router.js | head -40")
print(out)

# 2: Check model_mapping in Codesome provider
print("\n=== Codesome provider full config ===")
out, _ = run("curl -s http://localhost:8080/api/providers/2")
try:
    p = json.loads(out)
    print(f"  name: {p.get('name')}")
    print(f"  enabled: {p.get('enabled')}")
    print(f"  priority: {p.get('priority')}")
    print(f"  api_format: {p.get('api_format')}")
    print(f"  supported_models: {p.get('supported_models')}")
    print(f"  model_mapping: {p.get('model_mapping')}")
except:
    print(out[:500])

# 3: Check what model bots actually request (look at OpenClaw config)
print("\n=== OpenClaw config (Alin) ===")
out, _ = run("cat /Users/fangjin/Desktop/p/docker-openclawd/deploy/config/openclaw.json | python3 -m json.tool 2>/dev/null || cat /Users/fangjin/Desktop/p/docker-openclawd/deploy/config/openclaw.json")
# Show model-related lines
for line in out.split('\n'):
    if 'model' in line.lower() or 'claude' in line.lower() or 'sonnet' in line.lower() or 'opus' in line.lower():
        print(f"  {line.strip()}")

# Also show the full config for context
print("\n=== Full OpenClaw config ===")
print(out[:2000])

mac.close()
print("\n[DONE]")
