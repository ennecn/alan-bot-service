#!/usr/bin/env python3
"""
Install ui-ux-pro-max skill to all 4 OpenClaw bots in proper OpenClaw format.

Strategy:
1. Use Alin's existing git clone as source
2. Create clean OpenClaw skill structure in /tmp on Mac Mini
3. Copy to all 4 bot containers
"""
import paramiko
import sys

def run_cmd(cmd, verbose=True):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if verbose:
        if out:
            print(out)
        if err:
            print(err, file=sys.stderr)
    return out, err

DOCKER = '/usr/local/bin/docker'
SRC_CONTAINER = 'deploy-openclaw-gateway-1'
SRC_SKILL = '/home/node/.openclaw/skills/ui-ux-pro-max-skill'
SKILL_NAME = 'ui-ux-pro-max'
TMP_DIR = '/tmp/ui-ux-pro-max-skill-clean'
TARGET_DIR = f'/home/node/.openclaw/skills/{SKILL_NAME}'

CONTAINERS = [
    'deploy-openclaw-gateway-1',  # Alin
    'aling-gateway',               # Aling
    'lain-gateway',                # Lain
    'lumi-gateway',                # Lumi
]

# ── Step 1: Create clean skill structure on Mac Mini host ──
print('=' * 60)
print('Step 1: Creating clean OpenClaw skill structure...')
print('=' * 60)

# Build the clean skill directory by extracting from Alin's container
setup_cmd = f"""
rm -rf {TMP_DIR}
mkdir -p {TMP_DIR}/scripts {TMP_DIR}/data/stacks

# Copy Python scripts from source
{DOCKER} cp {SRC_CONTAINER}:{SRC_SKILL}/src/ui-ux-pro-max/scripts/search.py {TMP_DIR}/scripts/
{DOCKER} cp {SRC_CONTAINER}:{SRC_SKILL}/src/ui-ux-pro-max/scripts/core.py {TMP_DIR}/scripts/
{DOCKER} cp {SRC_CONTAINER}:{SRC_SKILL}/src/ui-ux-pro-max/scripts/design_system.py {TMP_DIR}/scripts/

# Copy data CSVs
for f in products.csv styles.csv colors.csv typography.csv landing.csv charts.csv ux-guidelines.csv icons.csv web-interface.csv react-performance.csv ui-reasoning.csv; do
    {DOCKER} cp {SRC_CONTAINER}:{SRC_SKILL}/src/ui-ux-pro-max/data/$f {TMP_DIR}/data/ 2>/dev/null || true
done

# Copy stack CSVs
for f in html-tailwind.csv react.csv nextjs.csv vue.csv svelte.csv shadcn.csv swiftui.csv react-native.csv flutter.csv nuxtjs.csv nuxt-ui.csv jetpack-compose.csv astro.csv; do
    {DOCKER} cp {SRC_CONTAINER}:{SRC_SKILL}/src/ui-ux-pro-max/data/stacks/$f {TMP_DIR}/data/stacks/ 2>/dev/null || true
done

echo "Files extracted:"
find {TMP_DIR} -type f | wc -l
"""
run_cmd(setup_cmd)

# ── Step 2: Create _meta.json ──
print('=' * 60)
print('Step 2: Creating _meta.json...')
print('=' * 60)

meta_cmd = f"""cat > {TMP_DIR}/_meta.json << 'METAEOF'
{{
  "slug": "ui-ux-pro-max",
  "name": "UI UX Pro Max",
  "version": "2.2.1"
}}
METAEOF
cat {TMP_DIR}/_meta.json
"""
run_cmd(meta_cmd)

# ── Step 3: Create SKILL.md with OpenClaw-compatible paths ──
print('=' * 60)
print('Step 3: Creating SKILL.md...')
print('=' * 60)

# The SKILL.md needs paths relative to OpenClaw skills dir
# In OpenClaw, skills are at /home/node/.openclaw/skills/<name>/
# So the search script path should be: skills/ui-ux-pro-max/scripts/search.py
skill_md_cmd = f"""cat > {TMP_DIR}/SKILL.md << 'SKILLEOF'
---
name: ui-ux-pro-max
description: "UI/UX design intelligence with 67 styles, 96 color palettes, 57 font pairings, 25 chart types, 13 tech stacks. Actions: plan, build, create, design, implement, review, fix, improve UI/UX code. Covers websites, landing pages, dashboards, mobile apps. Includes design system generator with 100 industry-specific reasoning rules."
---

# UI/UX Pro Max - Design Intelligence

Comprehensive design guide for web and mobile applications. Contains 67+ styles, 96 color palettes, 57 font pairings, 99 UX guidelines, and 25 chart types across 13 technology stacks. Searchable database with priority-based recommendations and AI-powered design system generation.

## When to Apply

Reference these guidelines when:
- Designing new UI components or pages
- Choosing color palettes and typography
- Reviewing code for UX issues
- Building landing pages or dashboards
- Implementing accessibility requirements
- Creating any user-facing interface

## Quick Reference

### Accessibility (CRITICAL)
- `color-contrast` - Minimum 4.5:1 ratio for normal text
- `focus-states` - Visible focus rings on interactive elements
- `alt-text` - Descriptive alt text for meaningful images
- `aria-labels` - aria-label for icon-only buttons
- `keyboard-nav` - Tab order matches visual order

### Touch & Interaction (CRITICAL)
- `touch-target-size` - Minimum 44x44px touch targets
- `cursor-pointer` - Add cursor-pointer to clickable elements
- `loading-buttons` - Disable button during async operations
- `error-feedback` - Clear error messages near problem

### Performance (HIGH)
- `image-optimization` - Use WebP, srcset, lazy loading
- `reduced-motion` - Check prefers-reduced-motion
- `content-jumping` - Reserve space for async content

### Layout & Responsive (HIGH)
- `viewport-meta` - width=device-width initial-scale=1
- `readable-font-size` - Minimum 16px body text on mobile
- `horizontal-scroll` - Ensure content fits viewport width

### Common Anti-Patterns
- **No emoji icons** - Use SVG icons (Heroicons, Lucide), never emojis as UI icons
- **Cursor pointer** - Add `cursor-pointer` to ALL clickable/hoverable elements
- **Smooth transitions** - Use `transition-colors duration-200`, not instant changes
- **Light mode contrast** - Use `bg-white/80` or higher, not `bg-white/10`

## How to Use

### Step 1: Analyze User Requirements

Extract from user request:
- **Product type**: SaaS, e-commerce, portfolio, dashboard, landing page, etc.
- **Style keywords**: minimal, playful, professional, elegant, dark mode, etc.
- **Industry**: healthcare, fintech, gaming, education, beauty, etc.
- **Stack**: React, Vue, Next.js, or default to `html-tailwind`

### Step 2: Generate Design System (REQUIRED)

**Always start with `--design-system`** for comprehensive recommendations:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <keywords>" --design-system [-p "Project Name"]
```

This searches 5 domains in parallel (product, style, color, landing, typography), applies 100 industry-specific reasoning rules, and returns a complete design system.

**Example:**
```bash
python3 skills/ui-ux-pro-max/scripts/search.py "beauty spa wellness service" --design-system -p "Serenity Spa"
```

### Step 2b: Persist Design System (optional)

Save design system for reuse across sessions:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --persist -p "Project Name"
```

Creates `design-system/MASTER.md` as source of truth, and optionally page-specific overrides with `--page "pagename"`.

### Step 3: Detailed Domain Searches (as needed)

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <domain> [-n <max_results>]
```

| Need | Domain | Example |
|------|--------|---------|
| Style options | `style` | `"glassmorphism dark"` |
| Chart types | `chart` | `"real-time dashboard"` |
| UX best practices | `ux` | `"animation accessibility"` |
| Alternative fonts | `typography` | `"elegant luxury"` |
| Landing structure | `landing` | `"hero social-proof"` |
| Color palettes | `color` | `"saas fintech"` |

### Step 4: Stack Guidelines

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<keyword>" --stack html-tailwind
```

Available stacks: `html-tailwind`, `react`, `nextjs`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`, `astro`, `shadcn`, `swiftui`, `react-native`, `flutter`, `jetpack-compose`

## Pre-Delivery Checklist

Before delivering UI code:

### Visual Quality
- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] Consistent icon set and sizing
- [ ] Hover states don't cause layout shift

### Interaction
- [ ] All clickable elements have `cursor-pointer`
- [ ] Transitions are smooth (150-300ms)
- [ ] Focus states visible for keyboard navigation

### Contrast & Modes
- [ ] Light mode text contrast 4.5:1 minimum
- [ ] Glass/transparent elements visible in light mode
- [ ] `prefers-reduced-motion` respected

### Responsive
- [ ] Works at 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile
- [ ] No content hidden behind fixed elements
SKILLEOF

echo "SKILL.md created ($(wc -l < {TMP_DIR}/SKILL.md) lines)"
"""
run_cmd(skill_md_cmd)

# ── Step 4: Install to all containers ──
print('=' * 60)
print('Step 4: Installing to all bot containers...')
print('=' * 60)

for container in CONTAINERS:
    print(f'\n  Installing to {container}...')

    install_cmd = f"""
# Remove old skill (both formats)
{DOCKER} exec {container} rm -rf /home/node/.openclaw/skills/ui-ux-pro-max 2>/dev/null || true
{DOCKER} exec {container} rm -rf /home/node/.openclaw/skills/ui-ux-pro-max-skill 2>/dev/null || true

# Create target directory structure
{DOCKER} exec {container} mkdir -p {TARGET_DIR}/scripts {TARGET_DIR}/data/stacks

# Copy files into container
{DOCKER} cp {TMP_DIR}/SKILL.md {container}:{TARGET_DIR}/SKILL.md
{DOCKER} cp {TMP_DIR}/_meta.json {container}:{TARGET_DIR}/_meta.json
{DOCKER} cp {TMP_DIR}/scripts/. {container}:{TARGET_DIR}/scripts/
{DOCKER} cp {TMP_DIR}/data/. {container}:{TARGET_DIR}/data/

# Verify
echo "  Files in {container}:"
{DOCKER} exec {container} find {TARGET_DIR} -type f | wc -l
{DOCKER} exec {container} ls {TARGET_DIR}/
"""
    run_cmd(install_cmd)

# ── Step 5: Verify Python & test search in each container ──
print('=' * 60)
print('Step 5: Verifying installation in each container...')
print('=' * 60)

for container in CONTAINERS:
    print(f'\n  Testing {container}...')

    test_cmd = f"""
# Check Python availability
PYTHON=$({DOCKER} exec {container} sh -c 'command -v python3 || command -v python || echo "NOT_FOUND"')
echo "  Python: $PYTHON"

# Check SKILL.md exists and has frontmatter
echo "  SKILL.md frontmatter:"
{DOCKER} exec {container} head -3 {TARGET_DIR}/SKILL.md

# Check data files
DATA_COUNT=$({DOCKER} exec {container} find {TARGET_DIR}/data -name '*.csv' -type f | wc -l)
echo "  Data CSV files: $DATA_COUNT"

# Quick test search (if python available)
if [ "$PYTHON" != "NOT_FOUND" ]; then
    echo "  Running test search..."
    {DOCKER} exec {container} sh -c "cd /home/node/.openclaw && $PYTHON skills/ui-ux-pro-max/scripts/search.py 'saas dashboard' --domain style -n 2 2>&1 | head -20"
else
    echo "  ⚠ Python not found - search script won't work"
fi
"""
    run_cmd(test_cmd)

# ── Cleanup ──
print('=' * 60)
print('Cleanup...')
print('=' * 60)
run_cmd(f'rm -rf {TMP_DIR}')

print('\n' + '=' * 60)
print('✓ Installation complete!')
print('=' * 60)
