---
name: image-gen
description: Generate images using Gemini 3 Pro Image model. Use when user asks to generate, create, draw, or make an image, picture, illustration, or artwork.
metadata: {"openclaw":{"emoji":"🎨","requires":{"bins":["python3"]}}}
---

# Image Generation (Gemini 3 Pro Image)

Generate images using `gemini-3-pro-image` via the Antigravity API proxy.

## When to Use

Activate this skill when the user asks you to:
- Generate, create, draw, or make an image / picture / illustration
- Create art, icons, logos, wallpapers, portraits
- Edit or modify a previously generated image
- Any request that requires producing visual output

## How to Generate

### Step 1: Craft an English prompt

Always translate the user's request to a **detailed English prompt**. Include:
- **Subject**: what to draw (a cat, a castle, a logo, etc.)
- **Style**: photorealistic, anime, watercolor, oil painting, pixel art, flat vector, etc.
- **Details**: colors, lighting, mood, composition, camera angle
- **Negative guidance**: "no text", "no watermark" if needed

Example: User says "画一只在彩虹上的猫" → prompt: "A cute cartoon cat sitting on a colorful rainbow, pastel colors, white background, kawaii style, no text"

### Step 2: Run the generation script

```bash
python3 {baseDir}/scripts/gen.py --prompt "YOUR ENGLISH PROMPT HERE"
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--prompt "..."` | Image description (required) | - |
| `--temperature N` | Creativity (0.0-2.0, higher = more creative) | 1.0 |
| `--outdir DIR` | Output directory | `/tmp/image-gen` |

The script outputs one line per image:

```
SAVED:/tmp/image-gen/img_1.jpeg
SAVED:/tmp/image-gen/img_2.jpeg
```

Or on error:

```
ERROR:No image in response
ERROR:API returned 503: ...
```

### Step 3: Send images to the user

For each `SAVED:` line, use the file path with the message tool to send the image to the user. Add a short caption describing what was generated.

If `ERROR:` appears, inform the user of the failure and suggest rephrasing.

## Tips for Great Results

- **Be specific**: "a fluffy orange tabby cat" > "a cat"
- **Mention style early**: "Anime-style portrait of..." or "Photorealistic photo of..."
- **The model generates 1-2 images** per request — this is normal
- **Generation takes 15-30 seconds** — it's not stuck, just working
- **English prompts** produce significantly better results than other languages
- If the first attempt isn't satisfying, rephrase with more detail and try again
