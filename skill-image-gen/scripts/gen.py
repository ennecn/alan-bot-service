#!/usr/bin/env python3
"""
Gemini 3 Pro Image generator via Antigravity API proxy.
Sends an OpenAI-compatible chat completion request, extracts inline
base64 images from the markdown response, and saves them to disk.
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.request
import urllib.error

API_URL = "http://138.68.44.141:8045/v1/chat/completions"
API_KEY = "sk-antigravity-openclaw"
MODEL = "gemini-3-pro-image"
DEFAULT_OUTDIR = "/tmp/image-gen"

# Regex to match inline base64 images: ![...](data:image/TYPE;base64,DATA)
IMG_RE = re.compile(
    r'!\[(?:[^\]]*)\]\(data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)\)'
)


def generate(prompt: str, temperature: float = 1.0) -> dict:
    """Call the Antigravity API and return the parsed JSON response."""
    payload = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8192,
        "temperature": temperature,
    }).encode()

    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"ERROR:API returned {e.code}: {body}", flush=True)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR:{e}", flush=True)
        sys.exit(1)


def extract_and_save(content: str, outdir: str) -> list[str]:
    """Extract base64 images from markdown content and save to disk."""
    os.makedirs(outdir, exist_ok=True)
    saved = []
    for i, m in enumerate(IMG_RE.finditer(content), 1):
        ext = m.group(1)
        data = m.group(2).replace("\n", "").replace(" ", "")
        path = os.path.join(outdir, f"img_{i}.{ext}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        saved.append(path)
    return saved


def main():
    parser = argparse.ArgumentParser(description="Generate images with Gemini 3 Pro Image")
    parser.add_argument("--prompt", required=True, help="Image description (English recommended)")
    parser.add_argument("--temperature", type=float, default=1.0, help="Creativity 0.0-2.0")
    parser.add_argument("--outdir", default=DEFAULT_OUTDIR, help="Output directory")
    args = parser.parse_args()

    resp = generate(args.prompt, args.temperature)

    # Extract content from the response
    choice = (resp.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content", "")

    if not content:
        print("ERROR:No content in response", flush=True)
        sys.exit(1)

    saved = extract_and_save(content, args.outdir)

    if not saved:
        # Maybe the model returned text only (refused or no image)
        text = content[:300] if len(content) < 500 else content[:300] + "..."
        print(f"ERROR:No image in response. Model said: {text}", flush=True)
        sys.exit(1)

    for path in saved:
        print(f"SAVED:{path}", flush=True)


if __name__ == "__main__":
    main()
