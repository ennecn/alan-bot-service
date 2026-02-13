#!/usr/bin/env python3
"""Test Gemini 3 Pro Image - various parameters and aspect ratios."""
import paramiko
import json
import time

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

def test_image(model, prompt, extra_params=None, test_name=""):
    print(f"\n{'='*60}")
    print(f"Test: {test_name}")
    print(f"Model: {model}")
    print(f"{'='*60}")

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 4096
    }
    if extra_params:
        payload.update(extra_params)

    cmd = f"""cat > /tmp/img_test.json << 'HEREDOC'
{json.dumps(payload)}
HEREDOC
curl -s -w '\\n---HTTP_STATUS:%{{http_code}}---' http://127.0.0.1:8045/v1/chat/completions \
  -H 'Authorization: Bearer sk-antigravity-openclaw' \
  -H 'Content-Type: application/json' \
  -d @/tmp/img_test.json"""

    start = time.time()
    out, err = run_vps(cmd)
    elapsed = time.time() - start

    status = ''
    body = out
    if '---HTTP_STATUS:' in out:
        parts = out.rsplit('---HTTP_STATUS:', 1)
        body = parts[0]
        status = parts[1].replace('---', '').strip()

    print(f"  HTTP: {status} | Time: {elapsed:.1f}s")

    try:
        resp = json.loads(body)
        choice = resp.get('choices', [{}])[0]
        msg = choice.get('message', {})
        content = msg.get('content', '')
        reasoning = msg.get('reasoning_content', '')
        usage = resp.get('usage', {})

        # Check if response contains image
        has_image = '![image](data:image/' in content
        # Count images
        img_count = content.count('![image](data:image/')
        # Get text content (non-image parts)
        text_parts = []
        for part in content.split('![image]'):
            clean = part.strip()
            if clean and not clean.startswith('(data:image/'):
                text_parts.append(clean[:200])

        print(f"  Images: {img_count}")
        print(f"  Content length: {len(content)} chars")
        if reasoning:
            print(f"  Reasoning: {reasoning[:200]}...")
        if text_parts:
            print(f"  Text: {text_parts[0][:200]}")
        print(f"  Usage: in={usage.get('prompt_tokens', '?')} out={usage.get('completion_tokens', '?')} total={usage.get('total_tokens', '?')}")
        print(f"  Finish reason: {choice.get('finish_reason', '?')}")

        # Image format check
        if has_image:
            # Extract first image data prefix
            img_start = content.find('data:image/')
            if img_start >= 0:
                img_type = content[img_start:img_start+30]
                print(f"  Image format: {img_type}...")
    except json.JSONDecodeError:
        print(f"  Raw (first 300): {body[:300]}")
        if err:
            print(f"  Stderr: {err[:300]}")

# Test A: Default model (standard resolution)
test_image(
    "gemini-3-pro-image",
    "Draw a simple red circle on a white background.",
    test_name="Default resolution"
)

# Test B: 4K resolution, 16:9
test_image(
    "gemini-3-pro-image-4k-16x9",
    "Draw a beautiful sunset over the ocean, photorealistic.",
    test_name="4K 16:9 widescreen"
)

# Test C: 1:1 square (good for avatars)
test_image(
    "gemini-3-pro-image-1x1",
    "Draw an anime-style girl portrait with short blue hair.",
    test_name="1:1 square"
)

# Test D: 9:16 portrait (phone wallpaper)
test_image(
    "gemini-3-pro-image-9x16",
    "Draw a vertical phone wallpaper with cherry blossoms and a moon.",
    test_name="9:16 portrait (phone)"
)

# Test E: With temperature parameter
test_image(
    "gemini-3-pro-image",
    "Draw a fantasy castle floating in the clouds.",
    extra_params={"temperature": 1.5},
    test_name="High temperature (1.5)"
)

# Test F: Image editing - multi-turn with image input
# (This tests if we can send an image and ask to modify it)
print(f"\n{'='*60}")
print("Test F: Text + image generation (multi-turn capability)")
print(f"{'='*60}")
test_image(
    "gemini-3-pro-image",
    "Generate two images: first a cat, then a dog. Place them side by side.",
    test_name="Multiple images in one response"
)

# Test G: 2K resolution
test_image(
    "gemini-3-pro-image-2k",
    "Draw a minimalist logo for a tech company called 'OpenClaw'.",
    test_name="2K resolution"
)
