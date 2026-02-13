#!/usr/bin/env python3
"""Inspect the actual response format from Antigravity for Gemini 3 Flash."""
import paramiko
import json

def run_vps(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('138.68.44.141', port=2222, username='root')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

# Test 1: Normal text response (no tools)
print("=" * 70)
print("TEST 1: Normal text response (no tools defined)")
print("=" * 70)
payload1 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Say hello in 3 words."}],
    "max_tokens": 100,
    "stream": False
})
cmd1 = f"""cat > /tmp/fmt_test1.json << 'EOF'
{payload1}
EOF
curl -s http://127.0.0.1:8045/v1/chat/completions -H 'Authorization: Bearer sk-antigravity-openclaw' -H 'Content-Type: application/json' -d @/tmp/fmt_test1.json"""
out, _ = run_vps(cmd1)
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:2000])
except:
    print(f"Raw: {out[:1000]}")

# Test 2: With tools defined - hoping model will use them
print("\n" + "=" * 70)
print("TEST 2: With tools defined (expecting tool_calls)")
print("=" * 70)
payload2 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "What's the weather in Tokyo?"}],
    "max_tokens": 500,
    "stream": False,
    "tools": [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["location"]
            }
        }
    }]
})
cmd2 = f"""cat > /tmp/fmt_test2.json << 'EOF'
{payload2}
EOF
curl -s http://127.0.0.1:8045/v1/chat/completions -H 'Authorization: Bearer sk-antigravity-openclaw' -H 'Content-Type: application/json' -d @/tmp/fmt_test2.json"""
out, _ = run_vps(cmd2)
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:3000])
except:
    print(f"Raw: {out[:1000]}")

# Test 3: With many tools (simulating OpenClaw's setup)
print("\n" + "=" * 70)
print("TEST 3: With many tools (simulating complex OpenClaw scenario)")
print("=" * 70)
payload3 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "List my cron jobs"}],
    "max_tokens": 500,
    "stream": False,
    "tools": [
        {"type": "function", "function": {"name": "mcp_cron", "description": "Manage cron jobs", "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["list", "create", "delete"]}}, "required": ["action"]}}},
        {"type": "function", "function": {"name": "exec", "description": "Execute shell command", "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}}},
        {"type": "function", "function": {"name": "read", "description": "Read a file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
        {"type": "function", "function": {"name": "message", "description": "Send message to user", "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}},
        {"type": "function", "function": {"name": "web_search", "description": "Search the web", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    ]
})
cmd3 = f"""cat > /tmp/fmt_test3.json << 'EOF'
{payload3}
EOF
curl -s http://127.0.0.1:8045/v1/chat/completions -H 'Authorization: Bearer sk-antigravity-openclaw' -H 'Content-Type: application/json' -d @/tmp/fmt_test3.json"""
out, _ = run_vps(cmd3)
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:3000])
except:
    print(f"Raw: {out[:2000]}")

# Test 4: Streaming with tools
print("\n" + "=" * 70)
print("TEST 4: Streaming with tools (raw SSE chunks)")
print("=" * 70)
payload4 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "List my cron jobs"}],
    "max_tokens": 500,
    "stream": True,
    "tools": [
        {"type": "function", "function": {"name": "mcp_cron", "description": "Manage cron jobs", "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["list", "create", "delete"]}}, "required": ["action"]}}},
        {"type": "function", "function": {"name": "exec", "description": "Execute shell command", "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}}},
    ]
})
cmd4 = f"""cat > /tmp/fmt_test4.json << 'EOF'
{payload4}
EOF
curl -s http://127.0.0.1:8045/v1/chat/completions -H 'Authorization: Bearer sk-antigravity-openclaw' -H 'Content-Type: application/json' -d @/tmp/fmt_test4.json"""
out, _ = run_vps(cmd4)
# Print all SSE events
print(out[:3000])
