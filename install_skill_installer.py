#!/usr/bin/env python3
"""
Create and install the 'skill-installer' skill to all 4 OpenClaw bots.
This meta-skill teaches bots how to convert any GitHub skill repo into
OpenClaw format and self-install it.
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
SKILL_NAME = 'skill-installer'
TMP_DIR = f'/tmp/{SKILL_NAME}-build'
TARGET_DIR = f'/home/node/.openclaw/skills/{SKILL_NAME}'

CONTAINERS = [
    'deploy-openclaw-gateway-1',  # Alin
    'aling-gateway',               # Aling
    'lain-gateway',                # Lain
    'lumi-gateway',                # Lumi
]

SKILL_MD = r'''---
name: skill-installer
description: "Install skills from GitHub repositories. Converts any GitHub skill repo (Claude Code, Cursor, Windsurf, generic) into OpenClaw format and self-installs it. Use when the user shares a GitHub URL and wants to install a skill, or says 'install this skill', 'add this skill', etc."
---

# Skill Installer

Convert and install skills from GitHub repositories into OpenClaw format.

## When to Use

Use this skill when:
- The user shares a GitHub URL to a skill repository
- The user says "install this skill", "add this skill", "setup this skill"
- The user mentions a skill by `owner/repo` format (e.g. `nextlevelbuilder/ui-ux-pro-max-skill`)
- The user asks to install a skill from any AI coding assistant platform

## Conversion Process

Follow these steps **exactly** to convert and install a GitHub skill:

### Step 1: Clone the Repository

```bash
REPO_URL="<github_url>"
SKILL_SLUG="<derived-skill-name>"   # e.g. "ui-ux-pro-max" (kebab-case, concise)
WORK_DIR="/tmp/skill-install-$$"

mkdir -p "$WORK_DIR"
git clone --depth 1 "$REPO_URL" "$WORK_DIR/repo"
```

If the user provides just `owner/repo`, prepend `https://github.com/`.

### Step 2: Detect Source Format & Find SKILL.md

Search for the main SKILL.md file. Check these locations in order:

| Priority | Path Pattern | Format |
|----------|-------------|--------|
| 1 | `SKILL.md` (root) | Generic / OpenClaw native |
| 2 | `.claude/skills/*/SKILL.md` | Claude Code plugin |
| 3 | `skills/*/SKILL.md` | Multi-skill repo (e.g. agent-skills) |
| 4 | `src/*/SKILL.md` | Source-based layout |
| 5 | `*.md` with YAML frontmatter containing `name:` | Fallback |

```bash
# Find all SKILL.md files
find "$WORK_DIR/repo" -name "SKILL.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
```

If **multiple SKILL.md** found (multi-skill repo), ask the user which one to install, or install all.

If **no SKILL.md** found, look for:
- `README.md` with skill-like content
- `.cursor/rules/*.mdc` files (Cursor rules)
- `.windsurf/rules/*.md` files (Windsurf rules)
- Any `.md` file with YAML frontmatter

### Step 3: Identify Essential Files

Beyond SKILL.md, identify supporting files the skill needs:

```bash
# Scripts (Python, JS, shell)
find "$WORK_DIR/repo" -name "*.py" -o -name "*.js" -o -name "*.mjs" -o -name "*.sh" \
  | grep -v node_modules | grep -v .git | grep -v cli/ | grep -v dist/

# Data files (CSV, JSON, YAML)
find "$WORK_DIR/repo" -name "*.csv" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" \
  | grep -v node_modules | grep -v .git | grep -v package.json | grep -v tsconfig.json

# Reference docs
find "$WORK_DIR/repo" -path "*/references/*.md" -not -path "*/node_modules/*"
```

**EXCLUDE** these (not needed for runtime):
- `.git/`, `node_modules/`, `dist/`, `build/`
- `cli/` (CLI installers for other platforms)
- `src/*/templates/platforms/` (platform-specific templates)
- `.claude-plugin/`, `.cursor/`, `.windsurf/`, `.shared/`
- `package.json`, `tsconfig.json`, `bun.lock`, `*.lock`
- `screenshots/`, `LICENSE`, `README.md`, `.gitignore`
- Test files (`*.test.*`, `*.spec.*`)

**INCLUDE** these (needed for skill to work):
- `scripts/` or `src/*/scripts/` — Executable scripts
- `data/` or `src/*/data/` — Data files (CSV, JSON)
- `references/` — Reference documentation
- `assets/` — Skill assets (if referenced in SKILL.md)
- Shell scripts (`.sh`) referenced in SKILL.md

### Step 4: Build OpenClaw Skill Directory

```
/home/node/.openclaw/skills/<SKILL_SLUG>/
├── SKILL.md          # Converted with proper frontmatter
├── _meta.json        # Metadata
├── scripts/          # From source (if any)
├── data/             # From source (if any)
└── references/       # From source (if any)
```

#### 4a: Create _meta.json

```json
{
  "slug": "<SKILL_SLUG>",
  "name": "<Human Readable Name>",
  "version": "<from source or 1.0.0>"
}
```

Extract version from `package.json`, `.claude-plugin/plugin.json`, or default to `"1.0.0"`.

#### 4b: Ensure SKILL.md Has Proper Frontmatter

OpenClaw requires YAML frontmatter with at minimum `name` and `description`:

```yaml
---
name: <skill-slug>
description: "<one-line description of what the skill does and when to use it>"
---
```

If the source SKILL.md already has frontmatter, keep it but ensure `name` and `description` are present.

If no frontmatter, add one. Derive the description from the first paragraph or README.

#### 4c: Fix Paths in SKILL.md

This is the most critical step. All paths in SKILL.md must be updated to work from the OpenClaw skills directory.

**Common path patterns to fix:**

| Source Path | OpenClaw Path |
|------------|---------------|
| `.claude/skills/<name>/scripts/X` | `skills/<SLUG>/scripts/X` |
| `scripts/X` | `skills/<SLUG>/scripts/X` |
| `src/<name>/scripts/X` | `skills/<SLUG>/scripts/X` |
| `assets/X` | `skills/<SLUG>/assets/X` |
| `data/X` | `skills/<SLUG>/data/X` |
| `references/X` | `skills/<SLUG>/references/X` |

**Path context:** OpenClaw runs commands from `/home/node/.openclaw/` as the working directory, so `skills/<SLUG>/scripts/search.py` resolves to `/home/node/.openclaw/skills/<SLUG>/scripts/search.py`.

**How to fix paths:**
1. Read the SKILL.md content
2. Find all file path references (in code blocks, inline code, bash commands)
3. Replace source-relative paths with `skills/<SLUG>/`-prefixed paths
4. Verify the referenced files actually exist in the output directory

#### 4d: Copy Files to Target

```bash
TARGET="/home/node/.openclaw/skills/$SKILL_SLUG"
rm -rf "$TARGET"
mkdir -p "$TARGET"

# Copy SKILL.md and _meta.json
cp <built_skill_md> "$TARGET/SKILL.md"
cp <built_meta_json> "$TARGET/_meta.json"

# Copy scripts (flatten from wherever they were in source)
if [ -d "$WORK_DIR/repo/src/<name>/scripts" ]; then
  cp -r "$WORK_DIR/repo/src/<name>/scripts" "$TARGET/scripts"
elif [ -d "$WORK_DIR/repo/scripts" ]; then
  cp -r "$WORK_DIR/repo/scripts" "$TARGET/scripts"
fi

# Copy data
if [ -d "$WORK_DIR/repo/src/<name>/data" ]; then
  cp -r "$WORK_DIR/repo/src/<name>/data" "$TARGET/data"
elif [ -d "$WORK_DIR/repo/data" ]; then
  cp -r "$WORK_DIR/repo/data" "$TARGET/data"
fi

# Copy references
if [ -d "$WORK_DIR/repo/references" ]; then
  cp -r "$WORK_DIR/repo/references" "$TARGET/references"
fi
```

### Step 5: Verify Installation

```bash
# Check files exist
ls -la "$TARGET/"
ls "$TARGET/SKILL.md"

# Verify frontmatter
head -5 "$TARGET/SKILL.md"

# Check any scripts are executable
find "$TARGET" -name "*.py" -o -name "*.sh" | head -5

# Test script if applicable (e.g. Python search)
python3 "$TARGET/scripts/search.py" --help 2>/dev/null || true
```

### Step 6: Cleanup

```bash
rm -rf "$WORK_DIR"
```

### Step 7: Report to User

Tell the user:
1. Skill name and what it does
2. What files were installed
3. How to use it (from SKILL.md)
4. Any issues or missing dependencies (e.g. Python not installed)

## Format Detection Cheat Sheet

| Indicator | Format | SKILL.md Location |
|-----------|--------|-------------------|
| `.claude-plugin/` exists | Claude Code Plugin | `.claude/skills/*/SKILL.md` |
| `.claude/skills/` exists | Claude Code native | `.claude/skills/*/SKILL.md` |
| `.cursor/` exists | Cursor | `.cursor/skills/*/SKILL.md` or `.cursor/rules/*.mdc` |
| `.windsurf/` exists | Windsurf | `.windsurf/rules/*.md` |
| `skills/*/SKILL.md` | Multi-skill (agent-skills) | `skills/*/SKILL.md` |
| `SKILL.md` at root | Generic | `SKILL.md` |
| `src/*/SKILL.md` | Source-based | `src/*/SKILL.md` |

## Multi-Skill Repos

Some repos contain multiple skills (e.g. `vercel-labs/agent-skills`). When detected:

1. List all available skills with their names
2. Ask the user which to install (or "all")
3. Install each as a separate skill directory under `/home/node/.openclaw/skills/`

## Converting Cursor Rules (.mdc)

Cursor `.mdc` files are rule files, not skills. To convert:

1. Read the `.mdc` file content
2. Extract the frontmatter (if any) and rule content
3. Wrap it in a SKILL.md format:
   ```yaml
   ---
   name: <rule-name>
   description: "<what this rule enforces>"
   ---
   ```
4. The body should describe when to apply the rules and list the rules themselves

## Edge Cases

- **No SKILL.md at all**: Create one from README.md content, extracting the purpose and usage instructions
- **Binary files**: Skip binary files, only copy text-based scripts and data
- **Large repos**: Only clone with `--depth 1`, skip `node_modules` and build artifacts
- **Private repos**: If git clone fails, tell the user to provide the repo content directly
- **Dependencies**: If the skill needs Python/Node/etc, check availability and warn the user

## NAS Backup (Optional)

After successful installation, optionally back up the skill to NAS for sharing with other bots:

```bash
cp -r "/home/node/.openclaw/skills/$SKILL_SLUG" "/mnt/nas/shared/skills/$SKILL_SLUG"
```

## Examples

### Example 1: Claude Code Plugin

User: "Install this skill: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill"

1. Clone → detect `.claude-plugin/` → Claude Code format
2. Find SKILL.md at `.claude/skills/ui-ux-pro-max/SKILL.md`
3. Find scripts at `src/ui-ux-pro-max/scripts/` (search.py, core.py, design_system.py)
4. Find data at `src/ui-ux-pro-max/data/` (24 CSV files)
5. Skip: `cli/`, `.git/`, `screenshots/`, `README.md`
6. Fix paths: `.claude/skills/ui-ux-pro-max/scripts/search.py` → `skills/ui-ux-pro-max/scripts/search.py`
7. Install to `/home/node/.openclaw/skills/ui-ux-pro-max/`

### Example 2: Multi-Skill Repo

User: "Install skills from https://github.com/vercel-labs/agent-skills"

1. Clone → detect `skills/*/SKILL.md` pattern → multi-skill
2. List: react-best-practices, composition-patterns, web-design-guidelines, etc.
3. Ask user which to install
4. For each: create separate skill directory with proper paths

### Example 3: Generic SKILL.md Repo

User: "Add https://github.com/someone/cool-skill"

1. Clone → find `SKILL.md` at root → generic format
2. Copy SKILL.md, scripts/, data/ as-is
3. Ensure frontmatter is present
4. Install to `/home/node/.openclaw/skills/cool-skill/`
'''

# ── Create and install ──
print('=' * 60)
print('Creating skill-installer skill...')
print('=' * 60)

# Write SKILL.md to temp
run_cmd(f"rm -rf {TMP_DIR} && mkdir -p {TMP_DIR}")

# Write via heredoc - need to escape for shell
import tempfile, os

# Write locally then transfer
local_skill_path = os.path.join(tempfile.gettempdir(), 'skill-installer-SKILL.md')
with open(local_skill_path, 'w', encoding='utf-8') as f:
    f.write(SKILL_MD)

local_meta_path = os.path.join(tempfile.gettempdir(), 'skill-installer-meta.json')
with open(local_meta_path, 'w', encoding='utf-8') as f:
    f.write('{\n  "slug": "skill-installer",\n  "name": "Skill Installer",\n  "version": "1.0.0"\n}\n')

# Upload via SFTP
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()
sftp.put(local_skill_path, f'{TMP_DIR}/SKILL.md')
sftp.put(local_meta_path, f'{TMP_DIR}/_meta.json')
sftp.close()
client.close()

print(f'Files uploaded to {TMP_DIR}')
run_cmd(f"wc -l {TMP_DIR}/SKILL.md; cat {TMP_DIR}/_meta.json")

# Install to all containers
print('=' * 60)
print('Installing to all bot containers...')
print('=' * 60)

for container in CONTAINERS:
    print(f'\n  {container}...')
    run_cmd(f"""
{DOCKER} exec {container} rm -rf {TARGET_DIR} 2>/dev/null || true
{DOCKER} exec {container} mkdir -p {TARGET_DIR}
{DOCKER} cp {TMP_DIR}/SKILL.md {container}:{TARGET_DIR}/SKILL.md
{DOCKER} cp {TMP_DIR}/_meta.json {container}:{TARGET_DIR}/_meta.json
echo "  Installed: $({DOCKER} exec {container} ls {TARGET_DIR}/)"
echo "  Frontmatter:"
{DOCKER} exec {container} head -3 {TARGET_DIR}/SKILL.md
""")

# Verify all skills on each bot
print('=' * 60)
print('Final skill inventory:')
print('=' * 60)
for container in CONTAINERS:
    run_cmd(f"echo '  {container}:' && {DOCKER} exec {container} ls /home/node/.openclaw/skills/ 2>/dev/null")

# Cleanup
run_cmd(f"rm -rf {TMP_DIR}")
os.remove(local_skill_path)
os.remove(local_meta_path)

print('\nDone!')
