---
name: image-gen
description: Generate images using Gemini 3 Pro Image model via the local API proxy. Use when the user asks to generate, create, or draw an image.
---

# Image Generation Skill

Generate images using the `gemini-3-pro-image` model through the local API proxy.

## When to Use

Use this skill when the user asks you to:
- Generate / create / draw an image or picture
- Make art, illustration, or artwork
- Any request that involves producing a visual image

## How to Generate an Image

### Step 1: Call the API and save images

Run this command via `exec`, replacing `IMAGE_PROMPT` with a detailed English description of the desired image:

```bash
curl -s -X POST http://127.0.0.1:8022/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: dummy" \
  -d '{"model":"gemini-3-pro-image","messages":[{"role":"user","content":"Generate an image: IMAGE_PROMPT"}],"max_tokens":4096}' \
  | python3 -c "
import sys, json, base64, re
data = json.load(sys.stdin)
count = 0
for block in data.get('content', []):
    if block.get('type') == 'text':
        for m in re.finditer(r'data:image/(jpeg|png);base64,([A-Za-z0-9+/=\n]+)', block['text']):
            count += 1
            path = '/tmp/gen_img_%d.%s' % (count, m.group(1))
            with open(path, 'wb') as f:
                f.write(base64.b64decode(m.group(2)))
            print('SAVED:' + path)
if count == 0:
    err = data.get('error')
    print('ERROR:' + (str(err) if err else 'No image generated'))
"
```

### Step 2: Send the image to the user

For each line starting with `SAVED:`, the file path after the colon is the generated image. Send it to the user using the `media.send` tool with that file path.

If you see `ERROR:`, tell the user what went wrong.

## Important Notes

- **Always translate** the user's prompt to English before calling the API — English prompts produce much better results
- Be descriptive: include style (photorealistic, anime, watercolor, oil painting), mood, colors, lighting, composition
- The model typically returns 1-2 images per request
- If generation fails, try rephrasing the prompt
