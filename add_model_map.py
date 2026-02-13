#!/usr/bin/env python3
"""Add Gemini model mapping to Antigravity provider."""
import paramiko, sys, io, json, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = mac.open_sftp()

# Read current remote config
with sftp.open('/Users/fangjin/llm-gateway-v2/config.json', 'r') as f:
    config = json.loads(f.read())

print("Current bot assignments:")
for k, v in config['bots'].items():
    name = v['name']
    provider = v['provider']
    print(f"  {name}: {provider}")

# Add modelMap to Antigravity
config['providers']['antigravity']['modelMap'] = {
    "claude-opus-4-6-20250514": "gemini-3-flash",
    "claude-opus-4-6": "gemini-3-flash",
    "claude-sonnet-4-5-20250929": "gemini-3-flash"
}

print("\nAntigravity modelMap added:")
for src, dst in config['providers']['antigravity']['modelMap'].items():
    print(f"  {src} -> {dst}")

# Save
with sftp.open('/Users/fangjin/llm-gateway-v2/config.json', 'w') as f:
    f.write(json.dumps(config, indent=2))
print("\nConfig saved.")

# Also update local copy
with open(r'd:\openclawVPS\llm-gateway-v2\config.json', 'w') as f:
    json.dump(config, f, indent=2)

# Restart gateway
def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

print("\nRestarting gateway...")
run('launchctl unload ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
time.sleep(2)
run('launchctl load ~/Library/LaunchAgents/com.llm-gateway.plist 2>&1')
time.sleep(3)

out = run('curl -s http://127.0.0.1:8080/health --max-time 5')
print(f"Health: {out}")

out = run('tail -5 /private/tmp/gateway-v2.log')
print(f"\nGateway log:\n{out}")

sftp.close()
mac.close()
print("\n[DONE]")
