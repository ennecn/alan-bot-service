#!/usr/bin/env python3
"""Test Gateway directly and check logs."""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('192.168.21.111', username='fangjin', password=r'YYZZ54321!')

def run(cmd, timeout=60):
    _, o, e = c.exec_command(f'zsh -l -c "{cmd}"', timeout=timeout)
    return o.read().decode().strip(), e.read().decode().strip()

# Write test script on Mac Mini
run("""cat > /tmp/test-gw.sh << 'EOF'
#!/bin/bash
curl -s -m 30 -X POST http://127.0.0.1:8080/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-opus-4-6","max_tokens":10,"messages":[{"role":"user","content":"say hi"}]}' 2>&1 | head -c 1000
EOF
chmod +x /tmp/test-gw.sh""")

print("=== Test Gateway directly ===")
o, e = run("bash /tmp/test-gw.sh")
print("Response:", o[:1000])
if e: print("Error:", e[:300])

# Check gateway logs
print("\n=== Gateway recent logs ===")
o, _ = run("tail -30 ~/llm-gateway/logs/gateway.log 2>/dev/null")
print(o[:2000] if o else "(no log file)")

# Also check if gateway has a different log location
print("\n=== Find gateway logs ===")
o, _ = run("find ~/llm-gateway -name '*.log' -mmin -60 2>/dev/null | head -5")
print(o if o else "(no recent logs)")

# Check gateway process
print("\n=== Gateway process ===")
o, _ = run("ps aux | grep llm-gateway | grep -v grep")
print(o[:500])

c.close()
