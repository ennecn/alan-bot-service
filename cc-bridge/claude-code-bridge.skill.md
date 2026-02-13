# Claude Code Bridge

Use this skill to delegate complex coding tasks to Claude Code running on the host machine. Claude Code has full access to the host filesystem, persistent session context, and uses a real Claude model via Codesome.

## When to Use

- Complex multi-file programming tasks
- Code refactoring, debugging, or architecture changes
- Tasks that require reading and understanding large codebases
- Any task that benefits from Claude Code's tool use (file edit, bash, grep, etc.)

## How It Works

Claude Code Bridge runs on the host machine (port 9090). You send a message, it routes to a persistent Claude Code session that maintains full conversation context across interactions.

## API

**Endpoint:** `http://host.docker.internal:9090`

### Send a coding task

```bash
curl -N http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "project-name-task-name",
    "message": "Your detailed task description here",
    "working_directory": "/Users/fangjin/path/to/project"
  }'
```

**Important parameters:**
- `session_id` — Use a descriptive, consistent ID to maintain context (e.g., `"web-im-auth-feature"`). Same ID = same conversation history.
- `message` — Be specific and detailed. Include file paths, expected behavior, and constraints.
- `working_directory` — The project root on the host machine.

### Check session status

```bash
curl http://host.docker.internal:9090/api/sessions
```

### View session history

```bash
curl http://host.docker.internal:9090/api/sessions/{session_id}
```

### Kill a stuck process

```bash
curl -X POST http://host.docker.internal:9090/api/sessions/{session_id}/kill
```

## Usage Pattern

### Step 1: Start a task

Use the `bash` tool to send a coding task to Claude Code Bridge. Always use `curl -N` for streaming and pipe through a filter to get the text output:

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "my-project-feature",
    "message": "Read the project structure and explain the architecture of this codebase",
    "working_directory": "/Users/fangjin/my-project"
  }' 2>&1 | grep "^data:" | head -50
```

### Step 2: Follow up (same session)

Use the **same session_id** to maintain context:

```bash
curl -sN http://host.docker.internal:9090/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "my-project-feature",
    "message": "Now implement the auth middleware we discussed"
  }' 2>&1 | grep "^data:" | head -50
```

### Step 3: Check progress

```bash
curl -s http://host.docker.internal:9090/api/sessions/my-project-feature
```

## Best Practices

1. **Use descriptive session IDs** — e.g., `"openclaw-web-im-chat-ui"`, not `"session1"`
2. **Be specific in messages** — Include file paths, function names, expected behavior
3. **One task at a time** — Wait for a task to complete before sending the next
4. **Check history** — Review session history to understand what Claude Code has done
5. **Long tasks** — For complex tasks, the response may take 30-120 seconds. Be patient.
6. **Working directory** — Always set this to the correct project root on the first message

## Known Projects on Host

- `/Users/fangjin/Desktop/p/docker-openclawd/` — OpenClaw deployment configs
- `/Users/fangjin/llm-gateway/` — LLM Gateway
- Other projects: check `/Users/fangjin/Desktop/p/` or `/Users/fangjin/projects/`
