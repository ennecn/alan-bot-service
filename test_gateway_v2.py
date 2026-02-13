#!/usr/bin/env python3
"""Test LLM Gateway V2 - all 3 providers via local gateway."""
import json, sys, io, urllib.request, urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

GW = "http://127.0.0.1:8080"

def api_call(path, method='GET', body=None, headers=None):
    url = f"{GW}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        return 0, {"error": str(e)}

# ============================================================
# Test 0: Health + Status + Web UI
# ============================================================
print("=" * 60)
print("Test 0: Health, Status, Web UI")
print("=" * 60)
code, data = api_call('/health')
print(f"  /health: {code} {data}")

code, data = api_call('/api/status')
print(f"  /api/status: {code}")
for b in data.get('bots', []):
    print(f"    {b['name']} -> {b['providerName']}")

# Check web UI loads
try:
    with urllib.request.urlopen(f"{GW}/", timeout=5) as resp:
        html = resp.read().decode()
        print(f"  Web UI: {resp.status}, size={len(html)} bytes, has Vue={'vue' in html.lower()}")
except Exception as e:
    print(f"  Web UI: ERROR {e}")

# ============================================================
# Test 1: Codesome (Anthropic passthrough) - via Lain's key
# ============================================================
print("\n" + "=" * 60)
print("Test 1: Codesome via Lain (Anthropic passthrough, tool use)")
print("=" * 60)

code, resp = api_call('/v1/messages', 'POST', {
    "model": "claude-opus-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."}],
    "tools": [{
        "name": "get_weather",
        "description": "Get weather",
        "input_schema": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}
    }]
}, {"x-api-key": "gw-lain-a90e1ca5a2110905fd0cb1279f74fd75", "anthropic-version": "2023-06-01"})

print(f"  Status: {code}")
if code == 200:
    stop = resp.get('stop_reason')
    tool_uses = [b for b in resp.get('content', []) if b.get('type') == 'tool_use']
    print(f"  stop_reason: {stop}")
    print(f"  tool_use blocks: {len(tool_uses)}")
    if tool_uses:
        tu = tool_uses[0]
        print(f"  tool_use: id={tu.get('id')}, name={tu.get('name')}, input={tu.get('input')}")
        print(f"  -> PASS")
    else:
        print(f"  -> FAIL: no tool_use in response")
else:
    print(f"  -> FAIL: {json.dumps(resp)[:300]}")

# ============================================================
# Test 2: T8star (Anthropic passthrough) - via Alin's key
# ============================================================
print("\n" + "=" * 60)
print("Test 2: T8star via Alin (Anthropic passthrough, tool use)")
print("=" * 60)

code, resp = api_call('/v1/messages', 'POST', {
    "model": "claude-opus-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "What is the weather in London? Use the get_weather tool."}],
    "tools": [{
        "name": "get_weather",
        "description": "Get weather",
        "input_schema": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}
    }]
}, {"x-api-key": "gw-alin-86f31cca5b0d93189ffca6887138ff41", "anthropic-version": "2023-06-01"})

print(f"  Status: {code}")
if code == 200:
    stop = resp.get('stop_reason')
    tool_uses = [b for b in resp.get('content', []) if b.get('type') == 'tool_use']
    print(f"  stop_reason: {stop}")
    print(f"  tool_use blocks: {len(tool_uses)}")
    if tool_uses:
        tu = tool_uses[0]
        print(f"  tool_use: id={tu.get('id')}, name={tu.get('name')}, input={tu.get('input')}")
        print(f"  -> PASS")
else:
    print(f"  -> FAIL: {json.dumps(resp)[:300]}")

# ============================================================
# Test 3: Switch Alin to Antigravity, test Anthropic→OpenAI conversion
# ============================================================
print("\n" + "=" * 60)
print("Test 3: Switch Alin to Antigravity + tool use conversion")
print("=" * 60)

# Switch provider
code, resp = api_call('/api/bots/gw-alin-86f31cca5b0d93189ffca6887138ff41/provider', 'PUT',
    {"provider": "antigravity"})
print(f"  Switch: {code} {resp}")

# Test tool use through Antigravity (Anthropic→OpenAI conversion)
code, resp = api_call('/v1/messages', 'POST', {
    "model": "gemini-3-flash",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "What is the weather in Paris? Use the get_weather tool."}],
    "tools": [{
        "name": "get_weather",
        "description": "Get weather for a location",
        "input_schema": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}
    }]
}, {"x-api-key": "gw-alin-86f31cca5b0d93189ffca6887138ff41", "anthropic-version": "2023-06-01"})

print(f"  Status: {code}")
if code == 200:
    stop = resp.get('stop_reason')
    content = resp.get('content', [])
    tool_uses = [b for b in content if b.get('type') == 'tool_use']
    print(f"  stop_reason: {stop} (expect 'tool_use')")
    print(f"  content blocks: {len(content)}")
    for b in content:
        print(f"    type={b.get('type')}, ", end='')
        if b['type'] == 'tool_use':
            print(f"id={b.get('id')}, name={b.get('name')}, input={b.get('input')}")
        elif b['type'] == 'text':
            print(f"text={b.get('text', '')[:100]}")
        else:
            print()
    if tool_uses and stop == 'tool_use':
        print(f"  -> PASS: Anthropic→OpenAI tool use conversion works!")
    else:
        print(f"  -> PARTIAL: stop_reason={stop}, tool_uses={len(tool_uses)}")
else:
    print(f"  -> FAIL: {json.dumps(resp)[:500]}")

# ============================================================
# Test 4: Multi-turn tool use through Antigravity
# ============================================================
print("\n" + "=" * 60)
print("Test 4: Multi-turn tool use through Antigravity")
print("=" * 60)

if code == 200 and tool_uses:
    tu = tool_uses[0]
    # Send tool result back
    code2, resp2 = api_call('/v1/messages', 'POST', {
        "model": "gemini-3-flash",
        "max_tokens": 256,
        "messages": [
            {"role": "user", "content": "What is the weather in Paris? Use the get_weather tool."},
            {"role": "assistant", "content": content},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": tu['id'],
                 "content": json.dumps({"temperature": 18, "condition": "cloudy"})}
            ]}
        ],
        "tools": [{
            "name": "get_weather",
            "description": "Get weather for a location",
            "input_schema": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}
        }]
    }, {"x-api-key": "gw-alin-86f31cca5b0d93189ffca6887138ff41", "anthropic-version": "2023-06-01"})

    print(f"  Status: {code2}")
    if code2 == 200:
        text_blocks = [b for b in resp2.get('content', []) if b.get('type') == 'text']
        print(f"  stop_reason: {resp2.get('stop_reason')}")
        if text_blocks:
            print(f"  response: {text_blocks[0]['text'][:200]}")
            print(f"  -> PASS: Multi-turn Anthropic→OpenAI→Anthropic works!")
        else:
            print(f"  -> PARTIAL: no text in response")
    else:
        print(f"  -> FAIL: {json.dumps(resp2)[:500]}")
else:
    print("  Skipped (Test 3 failed)")

# Switch Alin back to t8star
api_call('/api/bots/gw-alin-86f31cca5b0d93189ffca6887138ff41/provider', 'PUT', {"provider": "t8star"})
print("\n  (Alin switched back to T8star)")

# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print("""
Test 0: Health/Status/WebUI
Test 1: Codesome (Anthropic passthrough + tool use)
Test 2: T8star (Anthropic passthrough + tool use)
Test 3: Antigravity (Anthropic→OpenAI conversion + tool use)
Test 4: Antigravity multi-turn (tool result roundtrip)
""")
print("[DONE]")
