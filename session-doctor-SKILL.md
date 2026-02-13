---
name: session-doctor
description: "Diagnose and fix session bloat issues. Use when the bot stops calling tools, becomes unresponsive, or conversation context grows too large. Can reset sessions, check compaction settings, and verify session health."
---

# Session Doctor Skill

Diagnose and fix session-related issues, especially when the bot stops calling tools due to conversation history growing too large.

## When to Use

Use this skill when:
- The bot stops calling tools (responds with text only, ignores tool-use requests)
- The bot becomes slow or unresponsive
- A user or admin reports "skills not working"
- You need to check session health or reset a bloated session
- After a long conversation, the bot seems to "forget" its capabilities

## Root Cause

When conversation history exceeds ~400-500 messages (or ~80K+ tokens), the model may stop calling tools entirely. It still responds with text but "forgets" it can use tools. This is a context overload issue, not an API or proxy problem.

## Quick Diagnosis

### Step 1: Check Session Size

```bash
# Find the current session file for a Telegram DM user
# Replace <USER_ID> with the Telegram user ID (e.g., 6564284621)
SESSIONS_DIR="/home/node/.openclaw/agents/main/sessions"

# Check sessions.json for the mapping
python3 -c "
import json
with open('$SESSIONS_DIR/sessions.json') as f:
    d = json.load(f)
key = 'agent:main:telegram:dm:<USER_ID>'
if key in d:
    sid = d[key]['sessionId']
    print(f'Session ID: {sid}')
else:
    print('Session not found')
"
```

### Step 2: Check Message Count

```bash
# Count lines in the session file (each line = 1 event)
wc -l $SESSIONS_DIR/<SESSION_ID>.jsonl

# Check file size
ls -lh $SESSIONS_DIR/<SESSION_ID>.jsonl

# Thresholds:
#   < 200 lines / < 500KB  = healthy
#   200-500 lines / 500KB-2MB = monitor
#   > 500 lines / > 2MB = likely causing issues
```

### Step 3: Check via Proxy Logs (if api-proxy v2-debug is running)

```bash
# The proxy logs message count per request
# Look for "msgs=XXX" in docker logs
docker logs <CONTAINER_NAME> 2>&1 | grep "msgs=" | tail -5
```

## Fix: Reset a Bloated Session

### Step 1: Backup the Session

```bash
SESSIONS_DIR="/home/node/.openclaw/agents/main/sessions"
SESSION_ID="<SESSION_ID>"
TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%S.000Z)

# Create backup with .deleted suffix (OpenClaw convention)
cp "$SESSIONS_DIR/$SESSION_ID.jsonl" "$SESSIONS_DIR/$SESSION_ID.jsonl.deleted.$TIMESTAMP"
```

### Step 2: Remove Active Session File

```bash
rm "$SESSIONS_DIR/$SESSION_ID.jsonl"
```

### Step 3: Remove Entry from sessions.json

```bash
python3 -c "
import json
path = '$SESSIONS_DIR/sessions.json'
with open(path) as f:
    d = json.load(f)
key = 'agent:main:telegram:dm:<USER_ID>'
if key in d:
    del d[key]
    with open(path, 'w') as f:
        json.dump(d, f)
    print('Entry removed')
else:
    print('Key not found')
"
```

### Step 4: Verify

```bash
# Session file should be gone
ls "$SESSIONS_DIR/$SESSION_ID.jsonl" 2>&1
# Should show "No such file"

# Backup should exist
ls "$SESSIONS_DIR/$SESSION_ID.jsonl.deleted."*
```

The next message from the user will automatically create a fresh session. Telegram chat history is NOT affected -- only the AI's conversation context is reset.

## Prevention: Compaction Configuration

The following settings in `openclaw.json` prevent session bloat:

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "safeguard",
        "maxHistoryShare": 0.2
      },
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "15m",
        "minPrunableToolChars": 5000
      }
    }
  }
}
```

### What Each Setting Does

| Setting | Default | Recommended | Effect |
|---------|---------|-------------|--------|
| `compaction.mode` | `safeguard` | `safeguard` | Uses LLM to summarize old messages when context is too large |
| `compaction.maxHistoryShare` | `0.5` | `0.2` | History can use max 20% of context (40K tokens) instead of 50% (100K tokens). Triggers compaction much earlier |
| `contextPruning.mode` | `cache-ttl` | `cache-ttl` | Prunes old tool results based on age |
| `contextPruning.ttl` | `1h` | `15m` | Tool results older than 15 min get pruned (was 1 hour) |
| `contextPruning.minPrunableToolChars` | `50000` | `5000` | Prune tool results > 5KB (was 50KB) |

### How Compaction Works

1. **Context Pruning** (first line of defense): Old tool results are trimmed/cleared to save tokens
2. **Memory Flush**: Before compaction, the bot saves important memories to disk
3. **Compaction**: LLM summarizes old conversation into a compact summary
4. **Auto-retry**: If API returns context overflow, auto-compact and retry (up to 3 times)

## Session Key Formats

| Chat Type | Key Format | Example |
|-----------|------------|---------|
| Telegram DM | `agent:main:telegram:dm:<USER_ID>` | `agent:main:telegram:dm:6564284621` |
| Telegram Group | `agent:main:telegram:group:<GROUP_ID>` | `agent:main:telegram:group:-1003782495301` |
| Main/CLI | `agent:main:main` | `agent:main:main` |

## Important Notes

- **Telegram history is safe**: Resetting a session only clears the AI's conversation context. Telegram chat history is stored on Telegram's servers and is never affected.
- **Backup convention**: Use `.deleted.<TIMESTAMP>` suffix for backups (matches OpenClaw's internal convention).
- **Container restart not needed**: Session reset takes effect on the next message without restarting the container.
- **Config changes need restart**: Changes to `openclaw.json` (compaction settings) require a container restart: `docker compose restart`.
- **All 4 bots**: The compaction settings should be applied to all bots (Alin, Aling, Lain, Lumi).
