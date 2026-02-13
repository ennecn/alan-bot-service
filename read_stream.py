#!/usr/bin/env python3
"""Read the streamOpenAIToAnthropic function from Gateway V2."""
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

si, so, se = c.exec_command("cat /Users/fangjin/llm-gateway-v2/server.js")
js = so.read().decode("utf-8")

# Find the streamOpenAIToAnthropic function
start = js.find("function streamOpenAIToAnthropic")
if start == -1:
    print("Function not found!")
else:
    # Find the end of the function (matching braces)
    depth = 0
    end = start
    for i in range(start, len(js)):
        if js[i] == '{':
            depth += 1
        elif js[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    func = js[start:end]
    print(f"Lines: {js[:start].count(chr(10))+1} to {js[:end].count(chr(10))+1}")
    print(func)

# Also find the proxy handler section
proxy_start = js.find("// ─── LLM Proxy endpoint")
if proxy_start != -1:
    # Get the streaming part
    stream_check = js.find("if (body.stream)", proxy_start)
    if stream_check != -1:
        snippet = js[stream_check:stream_check+400]
        print("\n\n=== PROXY STREAMING SECTION ===")
        print(snippet)

c.close()
