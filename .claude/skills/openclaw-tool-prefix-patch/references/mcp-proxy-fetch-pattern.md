# mcpProxyFetch Pattern Reference

## Problem

The Anthropic API rejects requests when using Claude Code subscription credentials (OAuth tokens with `sk-ant-oat` prefix) if tool names collide with Claude Code's reserved/built-in tool names:

- `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`
- `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`
- `NotebookEdit`, `Skill`, `Task`, `TaskOutput`, `TodoWrite`
- `WebFetch`, `WebSearch`, `KillShell`

OpenClaw (and similar projects like pi-coding-agent, opencode) define their own agent tools with names like `read`, `write`, `edit` which collide case-insensitively.

## Solution: Fetch Interceptor

Wrap `globalThis.fetch` in a proxy that:

1. **Outbound** (before sending to API): Adds `mcp_` prefix to ALL tool names
2. **Inbound** (response stream): Strips `mcp_` prefix from tool names

### Outbound Prefixing Locations

Three places in the request body JSON need prefixing:

```
body.tools[].name              → tool definitions
body.messages[].content[].name → tool_use blocks in conversation history
body.tool_choice.name          → forced tool selection (if present)
```

### Inbound Stripping

The response is an SSE stream. Each chunk may contain `"name":"mcp_xxx"` patterns in `content_block_start` events of type `tool_use`. The regex:

```js
/"name"\s*:\s*"mcp_([^"]+)"/g → '"name":"$1"'
```

strips the prefix, restoring original tool names for the calling application.

### Key Implementation Details

- Use `TransformStream` to pipe the response body through the stripping transform
- Return a new `Response` object preserving status, statusText, and headers
- The `!name.startsWith(TOOL_PREFIX)` guard prevents double-prefixing on retries
- Non-JSON request bodies pass through unchanged (catch block ignores parse errors)

### Known Limitation: Chunk Boundary Splitting

If an SSE chunk boundary splits the `"name":"mcp_` pattern across two chunks, the regex won't match. This is unlikely for short tool names but can be hardened with a line-buffering approach if needed:

```js
// Buffered approach (more robust):
let buffer = "";
transform(chunk, controller) {
    buffer += new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete last line
    for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(stripMcpPrefix(line) + "\n"));
    }
}
flush(controller) {
    if (buffer) controller.enqueue(new TextEncoder().encode(stripMcpPrefix(buffer)));
}
```

## Origin

This pattern was pioneered by [opencode-anthropic-auth PR #14](https://github.com/anomalyco/opencode-anthropic-auth/pull/14) and ported from pi-coding-agent.

## Application Points

In OpenClaw's patched `anthropic.js`, the proxy is applied in the `createClient()` function to BOTH branches:

- **OAuth branch** (`sk-ant-oat` tokens): `fetch: mcpProxyFetch(globalThis.fetch)`
- **Non-OAuth branch** (API keys): `fetch: mcpProxyFetch(globalThis.fetch)`

Both branches need it because both may use Claude Code subscription credentials that enforce the tool name restrictions.
