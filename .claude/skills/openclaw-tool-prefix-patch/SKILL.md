---
name: openclaw-tool-prefix-patch
description: Patch OpenClaw's anthropic.js to add mcp_ prefix to tool names, avoiding conflicts with Claude Code's reserved tool names when using CC subscription credentials. Use when OpenClaw agent fails with "credential is only authorized" errors, when updating OpenClaw and the patch needs re-applying, or when debugging tool name conflicts with the Anthropic API. Also applicable to similar projects (pi-coding-agent, opencode) that proxy Anthropic API calls with custom tool names.
---

# OpenClaw Tool Prefix Patch

Patch OpenClaw's Anthropic provider to prefix all tool names with `mcp_` before sending to the API, and strip the prefix from responses. This avoids Claude Code subscription credential rejections caused by tool name collisions.

## When This Patch Is Needed

The Anthropic API rejects requests when:
1. Using Claude Code subscription credentials (OAuth `sk-ant-oat` tokens)
2. Request contains tool names matching Claude Code's built-in tools (`Read`, `Write`, `Edit`, etc.)

Symptom: Agent fails with error containing "credential is only authorized".

## Patch Workflow

### Step 1: Locate the file

The target file is the compiled Anthropic provider JS, mounted into the container:

```
/opt/openclaw-docker/patches-runtime/anthropic.js
```

This is mounted via `docker-compose.override.yml` into the container.

### Step 2: Add mcpProxyFetch function

Insert before `createClient()`, after `isOAuthToken()`:

```js
const TOOL_PREFIX = "mcp_";
function mcpProxyFetch(originalFetch) {
    return async function(url, opts) {
        if (opts?.body && typeof opts.body === "string") {
            try {
                const body = JSON.parse(opts.body);
                let modified = false;
                if (Array.isArray(body.tools)) {
                    for (const tool of body.tools) {
                        if (tool.name && !tool.name.startsWith(TOOL_PREFIX)) {
                            tool.name = TOOL_PREFIX + tool.name;
                            modified = true;
                        }
                    }
                }
                if (Array.isArray(body.messages)) {
                    for (const msg of body.messages) {
                        if (Array.isArray(msg.content)) {
                            for (const block of msg.content) {
                                if (block.type === "tool_use" && block.name &&
                                    !block.name.startsWith(TOOL_PREFIX)) {
                                    block.name = TOOL_PREFIX + block.name;
                                    modified = true;
                                }
                            }
                        }
                    }
                }
                if (body.tool_choice && body.tool_choice.name &&
                    !body.tool_choice.name.startsWith(TOOL_PREFIX)) {
                    body.tool_choice.name = TOOL_PREFIX + body.tool_choice.name;
                    modified = true;
                }
                if (modified) {
                    opts = { ...opts, body: JSON.stringify(body) };
                }
            } catch (e) { /* not JSON, pass through */ }
        }
        const response = await originalFetch(url, opts);
        if (response.body) {
            const transformedBody = response.body.pipeThrough(
                new TransformStream({
                    transform(chunk, controller) {
                        const text = new TextDecoder().decode(chunk);
                        const stripped = stripMcpPrefix(text);
                        controller.enqueue(new TextEncoder().encode(stripped));
                    }
                })
            );
            return new Response(transformedBody, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        }
        return response;
    };
}
function stripMcpPrefix(text) {
    return text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name":"$1"');
}
```

### Step 3: Apply to createClient()

In the `createClient()` function, add `fetch: mcpProxyFetch(globalThis.fetch)` to the Anthropic client constructor in **both** branches:

```js
// OAuth branch
const client = new Anthropic({
    apiKey: null,
    authToken: apiKey,
    baseURL: model.baseUrl || process.env.ANTHROPIC_BASE_URL,
    defaultHeaders,
    dangerouslyAllowBrowser: true,
    fetch: mcpProxyFetch(globalThis.fetch),  // ADD THIS
});

// Non-OAuth branch
const client = new Anthropic({
    apiKey,
    baseURL: model.baseUrl || process.env.ANTHROPIC_BASE_URL,
    dangerouslyAllowBrowser: true,
    defaultHeaders,
    fetch: mcpProxyFetch(globalThis.fetch),  // ADD THIS
});
```

### Step 4: Clean up debug code

Remove any `console.error("[PATCH-DEBUG]...")` or `debugFetch` functions from previous debugging sessions.

### Step 5: Deploy and verify

```bash
# Copy patched file to server
scp patches-runtime/anthropic.js office:/opt/openclaw-docker/patches-runtime/anthropic.js

# Restart gateway
ssh office "cd /opt/openclaw-docker && docker compose restart openclaw-gateway"

# Verify startup (no errors)
ssh office "cd /opt/openclaw-docker && docker compose logs openclaw-gateway --since 30s"

# Test agent
ssh office "cd /opt/openclaw-docker && docker compose run --rm openclaw-cli agent --agent main --message 'say hi briefly'"
```

Success criteria:
- Gateway starts with `listening on ws://0.0.0.0:18789`
- No "credential is only authorized" errors
- Agent responds to test message

## Re-applying After OpenClaw Updates

When OpenClaw updates, the original `anthropic.js` in the container image changes. To re-apply:

1. Extract the new original: `docker compose run --rm openclaw-gateway cat /path/to/anthropic.js > patches-runtime/anthropic.js`
2. Apply the patch (Steps 2-3 above)
3. Restart and verify (Step 5)

## Technical Details

For deeper understanding of the fetch interceptor pattern, chunk boundary considerations, and origin of this approach, see [references/mcp-proxy-fetch-pattern.md](references/mcp-proxy-fetch-pattern.md).
