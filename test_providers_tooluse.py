#!/usr/bin/env python3
"""Test Codesome and T8star Claude Opus 4.6 tool use compatibility for OpenClaw."""
import json, sys, io, urllib.request, urllib.error, ssl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ssl._create_default_https_context = ssl._create_unverified_context

PROVIDERS = {
    "Codesome": {
        "base_url": "https://v3.codesome.cn",
        "api_key": "sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8",
    },
    "T8star": {
        "base_url": "https://ai.t8star.cn",
        "api_key": "sk-RHLExha223hVLBoHxuiXK1d9ynqtvSTOX3CRlP7RupW5eERW",
    },
}

def api_call(base_url, api_key, body):
    url = f"{base_url}/v1/messages"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('x-api-key', api_key)
    req.add_header('anthropic-version', '2023-06-01')
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": {"status": e.code, "body": body[:1500]}}
    except Exception as e:
        return {"error": {"message": str(e)}}

for provider_name, cfg in PROVIDERS.items():
    base_url = cfg["base_url"]
    api_key = cfg["api_key"]

    print("=" * 70)
    print(f"PROVIDER: {provider_name} ({base_url})")
    print("=" * 70)

    # ============================================================
    # Test 1: Basic tool use - model should call the tool
    # ============================================================
    print(f"\n--- Test 1: Basic Tool Use (claude-opus-4-6) ---")

    resp1 = api_call(base_url, api_key, {
        "model": "claude-opus-4-6",
        "max_tokens": 1024,
        "messages": [
            {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."}
        ],
        "tools": [
            {
                "name": "get_weather",
                "description": "Get the current weather for a given location",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "City name"}
                    },
                    "required": ["location"]
                }
            }
        ]
    })

    print(json.dumps(resp1, indent=2, ensure_ascii=False)[:2000])

    if "error" in resp1:
        print(f"\n[FAIL] API error")
    else:
        stop = resp1.get("stop_reason")
        content = resp1.get("content", [])
        tool_uses = [b for b in content if b.get("type") == "tool_use"]

        print(f"\n[CHECK] stop_reason = '{stop}' (expect 'tool_use')")
        print(f"[CHECK] tool_use blocks = {len(tool_uses)}")

        for i, tu in enumerate(tool_uses):
            print(f"\n  Tool Use #{i+1}:")
            print(f"    [CHECK] id = '{tu.get('id')}'")
            print(f"    [CHECK] name = '{tu.get('name')}'")
            print(f"    [CHECK] input = {tu.get('input')}")
            has_id = bool(tu.get('id'))
            has_name = bool(tu.get('name'))
            has_input = tu.get('input') is not None
            if has_id and has_name and has_input:
                print(f"    -> PASS: All required fields present")
            else:
                print(f"    -> FAIL: Missing fields (id={has_id}, name={has_name}, input={has_input})")

        # Save tool_use info for Test 2
        if tool_uses:
            tool_use_block = tool_uses[0]
            tool_use_id = tool_use_block.get("id")

    # ============================================================
    # Test 2: Multi-turn - send tool result back
    # ============================================================
    print(f"\n--- Test 2: Multi-turn Tool Use (send tool result back) ---")

    if "error" not in resp1 and tool_uses:
        resp2 = api_call(base_url, api_key, {
            "model": "claude-opus-4-6",
            "max_tokens": 256,
            "messages": [
                {"role": "user", "content": "What is the weather in Tokyo? Use the get_weather tool."},
                {"role": "assistant", "content": resp1.get("content", [])},
                {"role": "user", "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": json.dumps({"temperature": 22, "unit": "celsius", "condition": "sunny"})
                    }
                ]}
            ],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get the current weather for a given location",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string", "description": "City name"}
                        },
                        "required": ["location"]
                    }
                }
            ]
        })

        print(json.dumps(resp2, indent=2, ensure_ascii=False)[:1500])

        if "error" in resp2:
            print(f"\n[FAIL] Multi-turn failed")
        else:
            stop2 = resp2.get("stop_reason")
            content2 = resp2.get("content", [])
            text_blocks = [b for b in content2 if b.get("type") == "text"]
            print(f"\n[CHECK] stop_reason = '{stop2}' (expect 'end_turn')")
            print(f"[CHECK] text response = {bool(text_blocks)}")
            if text_blocks:
                print(f"[CHECK] content: {text_blocks[0].get('text', '')[:200]}")
                print(f"-> PASS: Multi-turn tool use works")
    else:
        print("  Skipped (Test 1 failed)")

    # ============================================================
    # Test 3: Streaming tool use
    # ============================================================
    print(f"\n--- Test 3: Streaming Tool Use ---")

    stream_body = json.dumps({
        "model": "claude-opus-4-6",
        "max_tokens": 1024,
        "stream": True,
        "messages": [
            {"role": "user", "content": "Check weather in London using the tool."}
        ],
        "tools": [
            {
                "name": "get_weather",
                "description": "Get weather",
                "input_schema": {
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"]
                }
            }
        ]
    }).encode()

    url = f"{base_url}/v1/messages"
    req = urllib.request.Request(url, data=stream_body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('x-api-key', api_key)
    req.add_header('anthropic-version', '2023-06-01')

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode('utf-8', errors='replace')

        # Parse SSE events
        events = []
        tool_use_events = []
        for line in raw.split('\n'):
            if line.startswith('data: '):
                try:
                    evt = json.loads(line[6:])
                    events.append(evt)
                    etype = evt.get("type", "")
                    if "tool_use" in etype or evt.get("content_block", {}).get("type") == "tool_use":
                        tool_use_events.append(evt)
                except:
                    pass

        print(f"  Total SSE events: {len(events)}")
        print(f"  Tool-use related events: {len(tool_use_events)}")

        # Show key events
        for evt in events:
            etype = evt.get("type", "")
            if etype == "content_block_start" and evt.get("content_block", {}).get("type") == "tool_use":
                print(f"  [STREAM] content_block_start: tool_use id={evt['content_block'].get('id')} name={evt['content_block'].get('name')}")
            elif etype == "content_block_delta" and evt.get("delta", {}).get("type") == "input_json_delta":
                pass  # lots of these, skip
            elif etype == "message_delta":
                print(f"  [STREAM] message_delta: stop_reason={evt.get('delta', {}).get('stop_reason')}")
            elif etype == "message_stop":
                print(f"  [STREAM] message_stop")

        if tool_use_events:
            print(f"  -> PASS: Streaming tool use works")
        else:
            print(f"  -> Tool use events not detected in stream")
            # Show first few events for debugging
            for evt in events[:5]:
                print(f"  Event: {json.dumps(evt, ensure_ascii=False)[:200]}")

    except Exception as e:
        print(f"  [ERROR] {e}")

    # ============================================================
    # Test 4: Usage/tokens in response
    # ============================================================
    print(f"\n--- Test 4: Usage Stats ---")
    if "error" not in resp1:
        usage = resp1.get("usage", {})
        print(f"  [CHECK] input_tokens = {usage.get('input_tokens')}")
        print(f"  [CHECK] output_tokens = {usage.get('output_tokens')}")
        print(f"  [CHECK] cache_creation_input_tokens = {usage.get('cache_creation_input_tokens', 'N/A')}")
        print(f"  [CHECK] cache_read_input_tokens = {usage.get('cache_read_input_tokens', 'N/A')}")
        if usage.get('input_tokens') and usage.get('output_tokens'):
            print(f"  -> PASS: Usage stats present")
        else:
            print(f"  -> WARNING: Missing usage stats")

    print(f"\n{'='*70}\n")

print("[DONE]")
