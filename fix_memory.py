#!/usr/bin/env python3
"""Update MEMORY.md and TOOLS.md to reference new Claude Code skill"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
sftp = client.open_sftp()

workspace = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/workspace'

# ============================================================
# 1. Update MEMORY.md - fix Claude Code section
# ============================================================
with sftp.file(f'{workspace}/MEMORY.md', 'r') as f:
    memory = f.read().decode()

# Replace old Claude Code section
old_cc = '''- **Claude Code**：专用编程 agent，遇到编程任务优先调用
  - 用法：`pty: true` + `--permission-mode bypassPermissions`
  - 路径：workspace/.claude-code/claude
  - API：v3.codesome.cn（直连）'''

new_cc = '''- **Claude Code（Mac Mini远程）**：专用编程 agent，所有编程任务必须使用
  - **重要：不要自己写代码，所有编程任务都通过 /claude_code 技能派发到 Mac Mini 上的 Claude Code**
  - 派发方式：使用 nodes 工具调用 Mac Mini 上的 claude-code-dispatch.sh
  - 支持：进度查询、任务列表、停止任务、Telegram 完成通知
  - 详见 /claude_code 技能说明'''

if old_cc in memory:
    memory = memory.replace(old_cc, new_cc)
    with sftp.file(f'{workspace}/MEMORY.md', 'w') as f:
        f.write(memory)
    print("[1/2] MEMORY.md updated - Claude Code section fixed")
else:
    print("[1/2] WARNING: old Claude Code section not found in MEMORY.md, trying partial match...")
    # Try partial match
    if 'workspace/.claude-code/claude' in memory:
        memory = memory.replace(
            '- **Claude Code**',
            '- **Claude Code（Mac Mini远程）**'
        )
        # Find and replace the sub-items
        lines = memory.split('\n')
        new_lines = []
        skip_next = False
        for i, line in enumerate(lines):
            if 'workspace/.claude-code/claude' in line or 'pty: true' in line or 'v3.codesome.cn（直连）' in line:
                if 'pty: true' in line:
                    new_lines.append('  - **重要：不要自己写代码，所有编程任务都通过 /claude_code 技能派发到 Mac Mini 上的 Claude Code**')
                    new_lines.append('  - 派发方式：使用 nodes 工具调用 Mac Mini 上的 claude-code-dispatch.sh')
                    new_lines.append('  - 支持：进度查询、任务列表、停止任务、Telegram 完成通知')
                    new_lines.append('  - 详见 /claude_code 技能说明')
                continue
            new_lines.append(line)
        memory = '\n'.join(new_lines)
        with sftp.file(f'{workspace}/MEMORY.md', 'w') as f:
            f.write(memory)
        print("[1/2] MEMORY.md updated via partial match")
    else:
        print("[1/2] SKIP: Could not find Claude Code section to update")

# ============================================================
# 2. Update TOOLS.md - add Claude Code section
# ============================================================
with sftp.file(f'{workspace}/TOOLS.md', 'r') as f:
    tools = f.read().decode()

# Add Claude Code section after the NAS section
cc_section = '''
### Claude Code（Mac Mini 远程编程）
- **所有编程任务必须使用此技能，不要自己在聊天中写代码**
- 技能命令：`/claude_code`
- 派发脚本：`/Users/fangjin/claude-code-dispatch.sh`
- 工作目录：`/Users/fangjin/claude-workspace/alin`
- 用法示例：
  ```
  nodes(action="run", node="MacMini", command="/Users/fangjin/claude-code-dispatch.sh -p \\"任务描述\\" -n \\"task-name\\" -g \\"CHAT_ID\\"")
  ```
- 查进度：`/Users/fangjin/claude-code-status.sh -n task-name`
- 列任务：`/Users/fangjin/claude-code-list.sh`
- 停任务：`/Users/fangjin/claude-code-stop.sh -n task-name`
'''

if 'Claude Code' not in tools:
    # Insert after NAS section
    if '### NAS' in tools:
        # Find end of NAS section (next ### or ## or end)
        nas_idx = tools.index('### NAS')
        # Find the next section header after NAS
        rest = tools[nas_idx + len('### NAS'):]
        next_section = -1
        for marker in ['### ', '## ']:
            idx = rest.find(marker)
            if idx != -1 and (next_section == -1 or idx < next_section):
                next_section = idx

        if next_section != -1:
            insert_point = nas_idx + len('### NAS') + next_section
            tools = tools[:insert_point] + cc_section + '\n' + tools[insert_point:]
        else:
            # Append at end of NAS section
            tools = tools.rstrip() + '\n' + cc_section
    else:
        # Just append
        tools = tools.rstrip() + '\n' + cc_section

    with sftp.file(f'{workspace}/TOOLS.md', 'w') as f:
        f.write(tools)
    print("[2/2] TOOLS.md updated - Claude Code section added")
else:
    print("[2/2] TOOLS.md already has Claude Code section")

# ============================================================
# 3. Verify
# ============================================================
print("\n--- Verification ---")

# Check MEMORY.md
stdin, stdout, stderr = client.exec_command(
    f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep "claude_code\\|Mac Mini远程\\|不要自己写代码" /home/node/.openclaw/workspace/MEMORY.md 2>/dev/null'
)
print(f"MEMORY.md refs: {stdout.read().decode().strip()}")

# Check TOOLS.md
stdin, stdout, stderr = client.exec_command(
    f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep "claude-code-dispatch\\|不要自己" /home/node/.openclaw/workspace/TOOLS.md 2>/dev/null'
)
print(f"TOOLS.md refs: {stdout.read().decode().strip()}")

sftp.close()
client.close()
