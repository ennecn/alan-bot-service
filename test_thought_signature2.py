#!/usr/bin/env python3
"""Test 2: Verify if Antigravity's signature_cache is what makes it work.
Theory: Antigravity caches thought_signature by tool_call_id from Step 1.
Test: Use a FAKE tool_call_id that was never in the cache."""
import paramiko, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'
API_KEY = 'sk-antigravity-openclaw'

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect(HOST, port=PORT, username=USER, password=PASS)

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    return out

# ============================================================
# Test A: Fake tool_call_id (never seen by Antigravity) + NO signature
# This should FAIL if the signature_cache theory is correct
# ============================================================
print("=" * 70)
print("TEST A: Fake tool_call_id + NO extra_content signature")
print("  Expected: FAIL (400) if cache theory is correct")
print("=" * 70)

body_a = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "What is the weather in Tokyo?"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_FAKE_never_cached_12345",
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "arguments": "{\"location\": \"Tokyo\"}"
                    }
                }
            ]
        },
        {
            "role": "tool",
            "tool_call_id": "call_FAKE_never_cached_12345",
            "content": "{\"temperature\": 22, \"unit\": \"celsius\", \"condition\": \"sunny\"}"
        }
    ],
    "max_tokens": 256,
    "stream": False
})

out = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body_a}' --max-time 60"
)
print("\nResponse:")
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:1500])
    if 'error' in resp:
        err_str = json.dumps(resp['error'])
        if 'thought_signature' in err_str:
            print("\n-> FAILED as expected: thought_signature missing (cache miss)")
        else:
            print(f"\n-> FAILED with different error")
    else:
        content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
        print(f"\n-> UNEXPECTED SUCCESS: {content[:200]}")
        print("-> Cache theory WRONG, Antigravity handles it differently")
except:
    print(out[:1500])

# ============================================================
# Test B: Fake tool_call_id + WITH dummy signature
# This should SUCCEED if Antigravity passes extra_content through
# ============================================================
print("\n\n" + "=" * 70)
print("TEST B: Fake tool_call_id + WITH dummy signature")
print("  Expected: SUCCESS if extra_content is passed through")
print("=" * 70)

body_b = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "What is the weather in Tokyo?"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_FAKE_never_cached_67890",
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "arguments": "{\"location\": \"Tokyo\"}"
                    },
                    "extra_content": {
                        "google": {
                            "thought_signature": "skip_thought_signature_validator"
                        }
                    }
                }
            ]
        },
        {
            "role": "tool",
            "tool_call_id": "call_FAKE_never_cached_67890",
            "content": "{\"temperature\": 22, \"unit\": \"celsius\", \"condition\": \"sunny\"}"
        }
    ],
    "max_tokens": 256,
    "stream": False
})

out = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{body_b}' --max-time 60"
)
print("\nResponse:")
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:1500])
    if 'error' in resp:
        print("\n-> FAILED: extra_content NOT passed through (or other issue)")
    else:
        content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
        print(f"\n-> SUCCESS: {content[:200]}")
except:
    print(out[:1500])

# ============================================================
# Test C: Real flow - Step1 gets tool_call, Step2 sends result
#   but with a DIFFERENT Antigravity request (no cache relation)
# ============================================================
print("\n\n" + "=" * 70)
print("TEST C: Full real flow (Step1 -> Step2) in sequence")
print("=" * 70)

# Step 1: Get real tool call
print("Step 1: Getting real tool call...")
step1 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "Check weather in London using the tool."}
    ],
    "tools": [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"]
            }
        }
    }],
    "max_tokens": 1024,
    "stream": False
})

out = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{step1}' --max-time 60"
)
resp1 = json.loads(out)
print(json.dumps(resp1, indent=2, ensure_ascii=False)[:1000])

tc = resp1['choices'][0]['message']['tool_calls'][0]
real_id = tc['id']
real_args = tc['function']['arguments']
print(f"\n-> Got real tool_call_id: {real_id}")

# Step 2: Send tool result using the FULL assistant message from Step 1
print("\nStep 2: Sending tool result with real assistant message (no extra_content)...")
step2 = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "Check weather in London using the tool."},
        resp1['choices'][0]['message'],  # Use exact message from Step 1
        {
            "role": "tool",
            "tool_call_id": real_id,
            "content": "{\"temperature\": 10, \"condition\": \"rainy\"}"
        }
    ],
    "tools": [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"]
            }
        }
    }],
    "max_tokens": 256,
    "stream": False
})

out = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{step2}' --max-time 60"
)
print("\nResponse:")
try:
    resp2 = json.loads(out)
    print(json.dumps(resp2, indent=2, ensure_ascii=False)[:1500])
    if 'error' in resp2:
        err_str = json.dumps(resp2['error'])
        if 'thought_signature' in err_str:
            print("\n-> FAILED: Still need signature even with real ID + exact message replay")
        else:
            print(f"\n-> FAILED with different error")
    else:
        content = resp2.get('choices', [{}])[0].get('message', {}).get('content', '')
        print(f"\n-> SUCCESS: {content[:200]}")
        print("-> Antigravity's signature_cache is working!")
except:
    print(out[:1500])

# ============================================================
# Summary
# ============================================================
print("\n\n" + "=" * 70)
print("CONCLUSION")
print("=" * 70)
print("""
If Test A FAILS and Test B SUCCEEDS:
  -> Antigravity does NOT cache signatures, but DOES pass extra_content
  -> Fix: Middleware proxy to inject dummy signature

If Test A FAILS and Test B FAILS:
  -> Antigravity neither caches nor passes extra_content
  -> Fix: Need Antigravity update

If Test A SUCCEEDS and Test C SUCCEEDS:
  -> Antigravity v4.1.12 already handles signatures internally!
  -> Fix: No fix needed, it already works

If Test A FAILS and Test C SUCCEEDS:
  -> Antigravity caches signatures by tool_call_id
  -> Fix: OpenClaw must use real IDs from Antigravity responses
""")

vps.close()
print("[DONE]")
