import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

API_KEY = 'sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW'
BASE_URL = 'https://ai.t8star.cn'

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# Get full model list
result = run(
    f"curl -s '{BASE_URL}/v1/models' "
    f"-H 'Authorization: Bearer {API_KEY}' --max-time 15"
)

try:
    data = json.loads(result)
    models = [m['id'] for m in data.get('data', [])]
    
    # Filter Claude/Anthropic models
    claude_models = [m for m in models if 'claude' in m.lower() or 'anthropic' in m.lower()]
    print(f"=== Claude/Anthropic models ({len(claude_models)}) ===")
    for m in sorted(claude_models):
        print(f"  {m}")
    
    # Also show thinking models
    thinking_models = [m for m in models if 'think' in m.lower()]
    print(f"\n=== Thinking models ({len(thinking_models)}) ===")
    for m in sorted(thinking_models):
        print(f"  {m}")
    
    print(f"\n=== All models ({len(models)}) ===")
    for m in sorted(models):
        print(f"  {m}")
except Exception as e:
    print(f"Parse error: {e}")
    print(result[:5000])

mac.close()
