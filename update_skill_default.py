#!/usr/bin/env python3
"""Update SKILL.md to make Claude Code the default for ALL programming tasks"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

skill_dir = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/config/skills/claude-code'

# Read current
with sftp.file(f'{skill_dir}/SKILL.md', 'r') as f:
    content = f.read().decode()

# 1. Update frontmatter description to be more assertive
old_desc = 'description: Delegate complex programming tasks to Claude Code running on MacMini via tmux. Use when user asks for coding, debugging, scripting, or any software engineering task that benefits from file system access. Supports progress monitoring, task management, and automatic Telegram notifications.'
new_desc = 'description: "DEFAULT skill for ALL programming, coding, and software engineering tasks. Whenever the user asks you to write code, create a project, build an app, write a script, debug, fix bugs, refactor, or do ANY coding-related work, you MUST use this skill. Do NOT attempt to write code yourself — always delegate to Claude Code. This runs on a remote machine with full filesystem access, persistent sessions, and Agent Teams."'

content = content.replace(old_desc, new_desc)

# 2. Update the intro paragraph
old_intro = '''# Claude Code Skill (MacMini Remote)

Delegate programming tasks to **Claude Code** running on the Mac Mini host. Claude Code runs in a **tmux session** with full file system access, independent from your conversation. You can monitor progress, check status, and stop tasks at any time.'''

new_intro = '''# Claude Code Skill (MacMini Remote)

**This is your default tool for ALL programming tasks.** Whenever the user asks you to write code, create projects, build apps, write scripts, debug issues, or do any software engineering work, you MUST use this skill. Do NOT try to write code yourself in the chat — always delegate to Claude Code.

Claude Code runs on the Mac Mini host in a **tmux session** with full file system access, independent from your conversation. It can handle complex multi-file projects, run tests, install dependencies, and more. You can monitor progress, check status, and stop tasks at any time.'''

content = content.replace(old_intro, new_intro)

# 3. Update "When to Use" to be broader
old_when = '''## When to Use

Use this skill when the user asks you to:
- Write, create, or generate code / scripts / programs
- Debug, fix, or refactor existing code
- Build projects (web apps, APIs, tools, games, etc.)
- Any multi-step programming task requiring file system access
- Tasks that benefit from Claude Code's Agent Teams (parallel agents)'''

new_when = '''## When to Use

**Use this skill for ANY of the following — no need for the user to mention "Mac" or "Claude Code":**
- Writing ANY code, scripts, programs, or projects
- Creating browser extensions, web apps, APIs, CLI tools, games, bots, etc.
- Debugging, fixing, or refactoring code
- Installing packages, setting up projects, running builds
- Analyzing codebases, reviewing code, finding bugs
- Writing automation scripts, deployment configs, DevOps tasks
- ANY task that involves creating or modifying files on disk
- Basically: if it's programming-related, use this skill'''

content = content.replace(old_when, new_when)

# 4. Update "When NOT to Use" to be narrower
old_not = '''## When NOT to Use

- Simple code explanations (answer directly)
- One-liner snippets you can write inline
- Non-programming questions'''

new_not = '''## When NOT to Use

- Answering conceptual questions about programming (e.g., "什么是闭包？")
- Non-programming conversations
- That's it. If the user wants ANY code written or modified, use this skill.'''

content = content.replace(old_not, new_not)

with sftp.file(f'{skill_dir}/SKILL.md', 'w') as f:
    f.write(content)

# Bump version
meta = '{\n  "slug": "claude-code",\n  "name": "Claude Code (MacMini)",\n  "version": "2.2.0"\n}'
with sftp.file(f'{skill_dir}/_meta.json', 'w') as f:
    f.write(meta)

print("SKILL.md v2.2.0 deployed — Claude Code is now DEFAULT for all coding tasks")

# Verify key phrases in container
for phrase in ["MUST use this skill", "DEFAULT skill", "no need for the user to mention"]:
    stdin, stdout, stderr = client.exec_command(
        f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -c "{phrase}" /home/node/.openclaw/skills/claude-code/SKILL.md 2>/dev/null'
    )
    count = stdout.read().decode().strip()
    print(f'  "{phrase}": {count} match(es)')

sftp.close()
client.close()
