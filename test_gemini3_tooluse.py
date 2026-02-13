#!/usr/bin/env python3
"""Test Gemini 3 Flash tool use via Antigravity proxy on VPS.
Checks if the response format meets OpenClaw's requirements."""
import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'
PASS = 'YYZZ54321!'
API_KEY = 'sk-antigravity-openclaw'
BASE = 'http://127.0.0.1:8045/v1'

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect(HOST, port=PORT, username=USER, password=PASS)

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# ============================================================
# Test 1: Tool Use Request (non-streaming)
# ============================================================
print("=" * 70)
print("TEST 1: Tool Use - Non-Streaming (gemini-3-flash)")
print("=" * 70)

tooluse_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool to find out."}
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
                        "location": {
                            "type": "string",
                            "description": "The city name, e.g. Tokyo"
                        },
                        "unit": {
                            "type": "string",
                            "enum": ["celsius", "fahrenheit"],
                            "description": "Temperature unit"
                        }
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
    f"-d '{tooluse_body}' --max-time 60"
)

print("\n--- Raw Response ---")
print(out[:3000])

try:
    resp = json.loads(out)
    print("\n--- Parsed Response ---")
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:3000])

    print("\n--- OpenClaw Compatibility Check ---")
    choice = resp.get('choices', [{}])[0]
    msg = choice.get('message', {})
    finish = choice.get('finish_reason')

    # Check 1: finish_reason
    print(f"[CHECK] finish_reason = '{finish}'")
    if finish in ('tool_calls', 'stop'):
        print(f"  -> OK (OpenClaw expects 'tool_calls' for tool invocation, 'stop' for text)")
    else:
        print(f"  -> WARNING: unexpected finish_reason")

    # Check 2: tool_calls array
    tool_calls = msg.get('tool_calls', [])
    print(f"[CHECK] tool_calls present = {len(tool_calls) > 0} (count: {len(tool_calls)})")

    for i, tc in enumerate(tool_calls):
        print(f"\n  Tool Call #{i+1}:")
        print(f"    [CHECK] id = '{tc.get('id')}'")
        print(f"    [CHECK] type = '{tc.get('type')}'")
        print(f"    [CHECK] function.name = '{tc.get('function', {}).get('name')}'")
        print(f"    [CHECK] function.arguments = '{tc.get('function', {}).get('arguments')}'")

        # Validate arguments is valid JSON
        try:
            args = json.loads(tc.get('function', {}).get('arguments', '{}'))
            print(f"    [CHECK] arguments parsed OK: {args}")
        except:
            print(f"    [FAIL] arguments is NOT valid JSON!")

        # Check required fields
        has_id = bool(tc.get('id'))
        has_name = bool(tc.get('function', {}).get('name'))
        has_args = tc.get('function', {}).get('arguments') is not None
        print(f"    [RESULT] id={has_id}, name={has_name}, arguments={has_args}")
        if has_id and has_name and has_args:
            print(f"    -> PASS: All required fields present for OpenClaw")
        else:
            print(f"    -> FAIL: Missing required fields")

    # Check 3: message role
    print(f"\n[CHECK] message.role = '{msg.get('role')}'")

    # Check 4: model field
    print(f"[CHECK] model = '{resp.get('model')}'")

    # Check 5: usage
    usage = resp.get('usage', {})
    print(f"[CHECK] usage = {usage}")

except Exception as e:
    print(f"\n[ERROR] Failed to parse response: {e}")

# ============================================================
# Test 2: Tool Use with tool_choice = "required"
# ============================================================
print("\n\n" + "=" * 70)
print("TEST 2: Tool Use - tool_choice='required' (force tool call)")
print("=" * 70)

required_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "Hello, how are you?"}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "Read",
                "description": "Read a file from disk",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The file path to read"
                        }
                    },
                    "required": ["path"]
                }
            }
        }
    ],
    "tool_choice": "required",
    "max_tokens": 1024,
    "stream": False
})

out, err = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{required_body}' --max-time 60"
)

print("\n--- Parsed Response ---")
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:2000])
    choice = resp.get('choices', [{}])[0]
    print(f"\n[CHECK] finish_reason = '{choice.get('finish_reason')}'")
    print(f"[CHECK] tool_calls = {choice.get('message', {}).get('tool_calls', 'NONE')}")
except Exception as e:
    print(f"[ERROR] {e}")
    print(out[:1500])

# ============================================================
# Test 3: Streaming Tool Use
# ============================================================
print("\n\n" + "=" * 70)
print("TEST 3: Tool Use - Streaming (SSE format)")
print("=" * 70)

stream_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "Check the weather in Beijing using the tool."}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get weather for a location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string"}
                    },
                    "required": ["location"]
                }
            }
        }
    ],
    "tool_choice": "auto",
    "max_tokens": 1024,
    "stream": True
})

out, err = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{stream_body}' --max-time 60"
)

print("\n--- Raw SSE Stream ---")
print(out[:3000])

# Parse SSE events
print("\n--- Parsed SSE Events (tool-related) ---")
tool_call_chunks = []
for line in out.split('\n'):
    if line.startswith('data: ') and line != 'data: [DONE]':
        try:
            chunk = json.loads(line[6:])
            delta = chunk.get('choices', [{}])[0].get('delta', {})
            finish = chunk.get('choices', [{}])[0].get('finish_reason')
            if 'tool_calls' in delta or finish == 'tool_calls':
                print(json.dumps(chunk, indent=2, ensure_ascii=False))
                tool_call_chunks.append(chunk)
        except:
            pass

if tool_call_chunks:
    print(f"\n[CHECK] Found {len(tool_call_chunks)} streaming chunks with tool_calls")
    print("[CHECK] Streaming tool use: SUPPORTED")
else:
    print("\n[CHECK] No tool_call chunks found in stream")
    print("[CHECK] Streaming tool use: NOT DETECTED (may have returned text instead)")

# ============================================================
# Test 4: Multi-turn with tool result
# ============================================================
print("\n\n" + "=" * 70)
print("TEST 4: Multi-turn - Send tool result back to model")
print("=" * 70)

multiturn_body = json.dumps({
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "What is the weather in Tokyo?"},
        {"role": "assistant", "content": None, "tool_calls": [
            {
                "id": "call_test_001",
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "arguments": "{\"location\": \"Tokyo\"}"
                }
            }
        ]},
        {"role": "tool", "tool_call_id": "call_test_001", "content": "{\"temperature\": 22, \"unit\": \"celsius\", \"condition\": \"sunny\"}"}
    ],
    "max_tokens": 256,
    "stream": False
})

out, err = run(
    f"curl -s http://127.0.0.1:8045/v1/chat/completions "
    f"-H 'Authorization: Bearer {API_KEY}' "
    f"-H 'Content-Type: application/json' "
    f"-d '{multiturn_body}' --max-time 60"
)

print("\n--- Response ---")
try:
    resp = json.loads(out)
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:2000])
    choice = resp.get('choices', [{}])[0]
    msg = choice.get('message', {})
    print(f"\n[CHECK] Model processed tool result and responded with text: {bool(msg.get('content'))}")
    print(f"[CHECK] finish_reason = '{choice.get('finish_reason')}'")
    if msg.get('content'):
        print(f"[CHECK] Response content: {msg['content'][:200]}")
except Exception as e:
    print(f"[ERROR] {e}")
    print(out[:1500])

# ============================================================
# Summary
# ============================================================
print("\n\n" + "=" * 70)
print("SUMMARY: OpenClaw Tool Use Compatibility")
print("=" * 70)
print("""
OpenClaw requires from model provider:

REQUEST side:
  [?] tools array (type: function, function: {name, description, parameters})
  [?] tool_choice parameter (auto/none/required/{type:function,...})
  [?] JSON Schema for parameters (type: object, properties, required)

RESPONSE side:
  [?] finish_reason = "tool_calls" when model invokes tools
  [?] tool_calls[].id (unique tool call identifier)
  [?] tool_calls[].function.name (tool name)
  [?] tool_calls[].function.arguments (JSON string)
  [?] Streaming: SSE chunks with delta.tool_calls

MULTI-TURN:
  [?] Accept role="tool" messages with tool_call_id
  [?] Continue generation after receiving tool results

Check the test results above to see which features are supported.
""")

vps.close()
print("[DONE]")
