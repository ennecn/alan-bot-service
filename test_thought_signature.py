#!/usr/bin/env python3
"""Test if Antigravity passes through extra_content.google.thought_signature
to the Google API when we inject a dummy signature."""
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
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# ============================================================
# Step 1: First, make a real tool call to get a real response
# ============================================================
print("=" * 70)
print("STEP 1: Make a real tool call to get actual tool_calls response")
print("=" * 70)

step1_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather for a given location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "City name"}
                    },
                    "required": ["location"]
                }
            }
        }
    ],
    "tool_choice": "auto",
    "max_tokens": 1024,
    "stream": False
})

out, err = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{step1_body}' --max-time 60"
)

print("\nResponse:")
try:
    resp1 = json.loads(out)
    print(json.dumps(resp1, indent=2, ensure_ascii=False))
    choice = resp1['choices'][0]
    tool_calls = choice['message'].get('tool_calls', [])
    tool_call_id = tool_calls[0]['id'] if tool_calls else None
    print(f"\n-> Got tool_call_id: {tool_call_id}")
    print(f"-> Has extra_content? {any('extra_content' in tc for tc in tool_calls)}")
except Exception as e:
    print(f"ERROR: {e}")
    print(out[:2000])
    tool_call_id = None

# ============================================================
# Step 2: Test with dummy signature "skip_thought_signature_validator"
# ============================================================
print("\n\n" + "=" * 70)
print("STEP 2: Multi-turn with dummy signature (skip_thought_signature_validator)")
print("=" * 70)

if tool_call_id:
    step2_body = json.dumps({
        "model": "gemini-3-flash",
        "messages": [
            {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tool_call_id,
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
                "tool_call_id": tool_call_id,
                "content": "{\"temperature\": 22, \"unit\": \"celsius\", \"condition\": \"sunny\"}"
            }
        ],
        "max_tokens": 256,
        "stream": False
    })

    out, err = run(
        f"curl -s http://127.0.0.1:8045/v1/chat/completions "
        f"-H 'Authorization: Bearer {API_KEY}' "
        f"-H 'Content-Type: application/json' "
        f"-d '{step2_body}' --max-time 60"
    )

    print("\nResponse:")
    try:
        resp2 = json.loads(out)
        print(json.dumps(resp2, indent=2, ensure_ascii=False))
        if 'error' in resp2:
            print("\n-> FAILED: Antigravity likely did NOT pass through extra_content")
        else:
            content = resp2.get('choices', [{}])[0].get('message', {}).get('content', '')
            print(f"\n-> SUCCESS! Model responded: {content[:200]}")
            print("-> extra_content with dummy signature WAS passed through!")
    except Exception as e:
        print(f"ERROR: {e}")
        print(out[:2000])

# ============================================================
# Step 3: Try alternate approach - signature in a different position
# ============================================================
print("\n\n" + "=" * 70)
print("STEP 3: Alternative - dummy signature as 'context_engineering_is_the_way_to_go'")
print("=" * 70)

if tool_call_id:
    step3_body = json.dumps({
        "model": "gemini-3-flash",
        "messages": [
            {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"location\": \"Tokyo\"}"
                        },
                        "extra_content": {
                            "google": {
                                "thought_signature": "context_engineering_is_the_way_to_go"
                            }
                        }
                    }
                ]
            },
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": "{\"temperature\": 22, \"unit\": \"celsius\", \"condition\": \"sunny\"}"
            }
        ],
        "max_tokens": 256,
        "stream": False
    })

    out, err = run(
        f"curl -s http://127.0.0.1:8045/v1/chat/completions "
        f"-H 'Authorization: Bearer {API_KEY}' "
        f"-H 'Content-Type: application/json' "
        f"-d '{step3_body}' --max-time 60"
    )

    print("\nResponse:")
    try:
        resp3 = json.loads(out)
        print(json.dumps(resp3, indent=2, ensure_ascii=False))
        if 'error' in resp3:
            print("\n-> FAILED: This approach also did not work")
        else:
            content = resp3.get('choices', [{}])[0].get('message', {}).get('content', '')
            print(f"\n-> SUCCESS! Model responded: {content[:200]}")
    except Exception as e:
        print(f"ERROR: {e}")
        print(out[:2000])

# ============================================================
# Step 4: Try without extra_content but check the exact error
# ============================================================
print("\n\n" + "=" * 70)
print("STEP 4: Baseline - no signature at all (expect 400)")
print("=" * 70)

if tool_call_id:
    step4_body = json.dumps({
        "model": "gemini-3-flash",
        "messages": [
            {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tool_call_id,
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
                "tool_call_id": tool_call_id,
                "content": "{\"temperature\": 22, \"unit\": \"celsius\", \"condition\": \"sunny\"}"
            }
        ],
        "max_tokens": 256,
        "stream": False
    })

    out, err = run(
        f"curl -s http://127.0.0.1:8045/v1/chat/completions "
        f"-H 'Authorization: Bearer {API_KEY}' "
        f"-H 'Content-Type: application/json' "
        f"-d '{step4_body}' --max-time 60"
    )

    print("\nResponse:")
    try:
        resp4 = json.loads(out)
        print(json.dumps(resp4, indent=2, ensure_ascii=False))
        if 'error' in resp4:
            err_msg = json.dumps(resp4['error'])
            if 'thought_signature' in err_msg:
                print("\n-> Confirmed: still fails without signature (expected)")
            else:
                print(f"\n-> Different error: {err_msg[:300]}")
    except Exception as e:
        print(f"ERROR: {e}")
        print(out[:2000])

# ============================================================
# Summary
# ============================================================
print("\n\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)

vps.close()
print("\n[DONE]")
