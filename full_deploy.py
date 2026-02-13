import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

BASE = '/Users/fangjin/Desktop/p/docker-openclawd'

# ============================================================
# Step 1: Check current cc-bridge SKILL.md
# ============================================================
print("=== Current cc-bridge SKILL.md ===")
out, _ = run(f'cat {BASE}/deploy/config/skills/cc-bridge/SKILL.md 2>/dev/null')
print(out[:500] if out else "EMPTY/NOT FOUND")

# ============================================================
# Step 2: Write the improved SKILL.md
# ============================================================
SKILL_MD = r'''---
name: claude-code-bridge
description: Delegate complex programming tasks to Claude Code running on the host machine. Claude Code has full filesystem access, persistent sessions, tool use (bash, read, write, grep), and uses a real Claude model. Use for multi-file coding, debugging, refactoring, architecture analysis, and any task requiring deep code understanding.
---

# Claude Code Bridge

Delegate complex coding tasks to **Claude Code** running on the host machine. Claude Code is a powerful coding agent with full filesystem access, persistent context across messages, and real Claude model intelligence.

## When to Use This Skill

- **Complex multi-file programming** — refactoring, debugging, feature implementation
- **Code analysis** — understanding large codebases, finding bugs, reviewing architecture
- **DevOps tasks** — writing scripts, configuring deployments, analyzing logs
- **Any task requiring tool use** — Claude Code can run bash commands, read/write files, search code
- **Tasks that need persistent context** — Claude Code remembers the full conversation within a session

## When NOT to Use

- Simple text answers or conversations (just respond directly)
- Tasks unrelated to code or the host filesystem
- When you already have the information needed

## API Endpoint

**Base URL:** `http://host.docker.internal:9090`

## Quick Start

### Send a coding task

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "YOUR-SESSION-NAME",
    "message": "Your detailed task description",
    "working_directory": "/Users/fangjin/path/to/project"
  }' 2>&1 | grep '^data:' | while read -r line; do
    data="${line#data: }"
    type=$(echo "$data" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type',''))" 2>/dev/null)
    if [ "$type" = "result" ]; then
      echo "$data" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))" 2>/dev/null
    fi
  done
```

### Simplified version (get full SSE output)

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SESSION_ID","message":"TASK","working_directory":"/Users/fangjin/PROJECT"}' \
  2>&1 | grep '^data:'
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `session_id` | Yes | Persistent session name. Use descriptive names like `"web-im-chat-feature"`. Same ID = continued conversation with full context. |
| `message` | Yes | The task or question. Be specific: include file paths, function names, expected behavior. |
| `working_directory` | Recommended | Project root on host filesystem. Set on first message; persists within session. |
| `model` | No | Override model (default: whatever Claude Code is configured with). |

## Session Management

Sessions are **persistent** — Claude Code remembers everything within a session. Use this strategically:

### Check all sessions
```bash
curl -s http://host.docker.internal:9090/api/sessions
```

### View session history
```bash
curl -s http://host.docker.internal:9090/api/sessions/SESSION_ID
```

### Kill a stuck session process
```bash
curl -X POST http://host.docker.internal:9090/api/sessions/SESSION_ID/kill
```

### Health check
```bash
curl -s http://host.docker.internal:9090/health
```

## Usage Patterns

### Pattern 1: Explore → Understand → Implement

```bash
# Message 1: Explore the codebase
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"myproject-feature-x","message":"Read the project structure and explain the architecture. Focus on the authentication flow.","working_directory":"/Users/fangjin/Desktop/p/myproject"}' \
  2>&1 | grep '^data:'

# Message 2: Implement (same session, Claude Code remembers context)
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"myproject-feature-x","message":"Now add JWT token refresh logic to the auth middleware we discussed."}' \
  2>&1 | grep '^data:'
```

### Pattern 2: Debug an issue

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"debug-login-bug","message":"Users report 500 errors on login. Check the auth handler in src/routes/auth.ts, look at recent error logs in logs/, and find the root cause.","working_directory":"/Users/fangjin/Desktop/p/myproject"}' \
  2>&1 | grep '^data:'
```

### Pattern 3: Analyze and report

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"code-review","message":"Review the recent changes in src/ and give me a summary of code quality issues, potential bugs, and improvement suggestions.","working_directory":"/Users/fangjin/Desktop/p/myproject"}' \
  2>&1 | grep '^data:'
```

## Parsing the Response

The response is Server-Sent Events (SSE). Key event types:

- `event: session` — Session info (session_id, uuid)
- `event: claude` — Claude Code stream events (contains `type: "assistant"` with content, or `type: "result"` with final text)
- `event: done` — Task complete (contains `exit_code`)
- `event: error` — Error occurred

### Extract just the final result text:

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"test","message":"What is 2+2?"}' 2>&1 \
  | grep '^data:' \
  | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if line.startswith('data: '):
        try:
            d = json.loads(line[6:])
            if d.get('type') == 'result':
                print(d.get('result', ''))
            elif d.get('type') == 'assistant':
                for b in d.get('message', {}).get('content', []):
                    if b.get('type') == 'text':
                        print(b['text'])
        except: pass
"
```

## Known Project Paths on Host

- `/Users/fangjin/Desktop/p/docker-openclawd/` — OpenClaw bot deployment configs
- `/Users/fangjin/llm-gateway/` — LLM Gateway (router, proxy, providers)
- `/Users/fangjin/Desktop/p/` — General project directory

## Best Practices

1. **Descriptive session IDs** — `"openclaw-web-im-auth"` not `"s1"`. Include project and task.
2. **Be specific** — Include file paths, function names, error messages, expected behavior.
3. **One task per message** — Don't combine multiple unrelated tasks in one message.
4. **Reuse sessions** — For related work on the same project, keep using the same session ID.
5. **New session for new context** — For unrelated tasks, use a new session ID.
6. **Be patient** — Complex tasks may take 30-120 seconds.
7. **Always set working_directory** on the first message of a new session.
8. **Check before creating** — Use `curl -s http://host.docker.internal:9090/api/sessions` to see existing sessions.

## Troubleshooting

- **409 Conflict** — Session has an active process. Wait for it or kill it with `/api/sessions/ID/kill`.
- **Empty response** — Check bridge health: `curl http://host.docker.internal:9090/health`
- **exit_code 1** — Claude Code encountered an error. Check the error events in the SSE stream.
'''

# Write the skill via SFTP
sftp = mac.open_sftp()

# Deploy dirs mapping: { dir_name: bot_name }
deploys = {
    'deploy': 'Alin',
    'deploy-aling': 'Aling',
    'deploy-lain': 'Lain',
    'deploy-lumi': 'Lumi',
}

for deploy_dir, bot_name in deploys.items():
    skill_dir = f'{BASE}/{deploy_dir}/config/skills/cc-bridge'
    # Create skill dir if not exists
    try:
        sftp.stat(skill_dir)
    except FileNotFoundError:
        sftp.mkdir(skill_dir)
        print(f"Created skill dir for {bot_name}: {skill_dir}")

    # Write SKILL.md
    skill_path = f'{skill_dir}/SKILL.md'
    with sftp.open(skill_path, 'w') as f:
        f.write(SKILL_MD)
    print(f"Deployed SKILL.md to {bot_name} ({deploy_dir})")

sftp.close()

# ============================================================
# Step 3: Start all bot containers
# ============================================================
print("\n=== Starting bot containers ===")
for deploy_dir, bot_name in deploys.items():
    compose_dir = f'{BASE}/{deploy_dir}'
    print(f"\nStarting {bot_name} ({deploy_dir})...")
    out, err = run(f'cd {compose_dir} && docker compose up -d 2>&1', timeout=120)
    print(f"  {out}")
    if err:
        print(f"  ERR: {err[:300]}")

# Wait for containers to start
print("\nWaiting 10s for containers to start...")
time.sleep(10)

# ============================================================
# Step 4: Verify containers running
# ============================================================
print("\n=== Verify containers ===")
out, _ = run('docker ps --format "table {{.Names}}\t{{.Status}}" | head -10')
print(out)

# ============================================================
# Step 5: Verify skill is accessible inside a container
# ============================================================
print("\n=== Verify skill in Alin container ===")
# The config is mounted at /home/node/.openclaw
container_name_out, _ = run(f'cd {BASE}/deploy && docker compose ps --format "{{{{.Name}}}}" | head -1')
print(f"Alin container name: {container_name_out}")

if container_name_out:
    out, _ = run(f'docker exec {container_name_out} cat /home/node/.openclaw/skills/cc-bridge/SKILL.md | head -20')
    print(f"Skill content (first 20 lines):\n{out}")
    
    # Test bridge connectivity from inside container
    out, _ = run(f'docker exec {container_name_out} curl -s http://host.docker.internal:9090/health --max-time 5')
    print(f"\nBridge health from container: {out}")

mac.close()
print("\n[DONE]")
