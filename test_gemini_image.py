#!/usr/bin/env python3
"""Test Gemini 3 Pro Image generation via Antigravity."""
import paramiko
import json
import sys

HOST = '138.68.44.141'
PORT = 2222
USER = 'root'

def run_vps(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

# Test 1: Basic image generation request
print("=" * 60)
print("Test 1: gemini-3-pro-image (default)")
print("=" * 60)

payload = json.dumps({
    "model": "gemini-3-pro-image",
    "messages": [
        {"role": "user", "content": "Generate a cute cartoon cat sitting on a rainbow. Only output the image, no text."}
    ],
    "max_tokens": 4096
})

# Use a temp file to avoid shell escaping issues
cmd = f"""cat > /tmp/img_test.json << 'HEREDOC'
{payload}
HEREDOC
curl -s -w '\\n---HTTP_STATUS:%{{http_code}}---' http://127.0.0.1:8045/v1/chat/completions \
  -H 'Authorization: Bearer sk-antigravity-openclaw' \
  -H 'Content-Type: application/json' \
  -d @/tmp/img_test.json"""

out, err = run_vps(cmd)

# Parse response
status_line = ''
body = out
if '---HTTP_STATUS:' in out:
    parts = out.rsplit('---HTTP_STATUS:', 1)
    body = parts[0]
    status_line = parts[1].replace('---', '')

print(f"HTTP Status: {status_line}")

try:
    resp = json.loads(body)
    # Print structure without full base64 data
    def summarize(obj, depth=0):
        indent = "  " * depth
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, str) and len(v) > 200:
                    print(f"{indent}{k}: <string len={len(v)}, first 100 chars: {v[:100]}...>")
                elif isinstance(v, (dict, list)):
                    print(f"{indent}{k}:")
                    summarize(v, depth + 1)
                else:
                    print(f"{indent}{k}: {v}")
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                print(f"{indent}[{i}]:")
                summarize(item, depth + 1)
        else:
            print(f"{indent}{obj}")

    summarize(resp)
except json.JSONDecodeError:
    print(f"Raw response (first 500): {body[:500]}")
    if err:
        print(f"Stderr: {err[:500]}")

# Test 2: Check what parameters are available
print("\n" + "=" * 60)
print("Test 2: List all image model variants")
print("=" * 60)
out, _ = run_vps("curl -s http://127.0.0.1:8045/v1/models -H 'Authorization: Bearer sk-antigravity-openclaw'")
models = json.loads(out)
image_models = [m['id'] for m in models['data'] if 'image' in m['id']]
for m in sorted(image_models):
    print(f"  {m}")
