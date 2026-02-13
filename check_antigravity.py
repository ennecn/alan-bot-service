import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ============================================================
# Part 1: Check Antigravity on VPS
# ============================================================
print("=" * 60)
print("Part 1: Check Antigravity service on VPS")
print("=" * 60)

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', username='root', password='YYZZ54321!')

# Check if antigravity is running
stdin, stdout, stderr = vps.exec_command('lsof -i :8045 | head -5')
print("Port 8045 (Antigravity):")
print(stdout.read().decode())

# List available models
stdin, stdout, stderr = vps.exec_command('curl -s http://127.0.0.1:8045/v1/models 2>/dev/null | python3 -m json.tool 2>/dev/null || curl -s http://127.0.0.1:8045/v1/models')
models_out = stdout.read().decode()
print("Available models:")
print(models_out[:2000])

# Test with a small request to Gemini 3 Flash
print("\n--- Testing Gemini 3 Flash with a small request ---")
test_cmd = """curl -s -w '\\nHTTP_CODE:%{http_code}' http://127.0.0.1:8045/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemini-3-flash","messages":[{"role":"user","content":"Say hi in 3 words"}],"max_tokens":20}' \
  --max-time 30"""
stdin, stdout, stderr = vps.exec_command(test_cmd)
test_result = stdout.read().decode()
print(f"Response: {test_result[:1000]}")

vps.close()

# ============================================================
# Part 2: Check Gateway provider status on Mac Mini
# ============================================================
print("\n" + "=" * 60)
print("Part 2: Check Gateway provider & fallback status")
print("=" * 60)

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Get all providers
stdin, stdout, stderr = mac.exec_command('curl -s http://127.0.0.1:8080/api/providers 2>/dev/null')
providers = stdout.read().decode()
print("Providers:")
try:
    ps = json.loads(providers)
    for p in ps:
        print(f"  [{p.get('id')}] {p.get('name')} - status={p.get('status')} priority={p.get('priority')} endpoint={p.get('endpoint')}")
except:
    print(providers[:1000])

# Get fallback status
stdin, stdout, stderr = mac.exec_command('curl -s http://127.0.0.1:8080/api/fallback/status 2>/dev/null')
fb_status = stdout.read().decode()
print("\nFallback status:")
print(fb_status[:1000])

mac.close()
print("\n[DONE]")
