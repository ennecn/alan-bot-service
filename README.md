# Alan — Behavioral Engine for AI Characters

Alan is a behavioral engine that adds emotional dynamics, impulse-driven decision-making, and World Info activation to AI character interactions. It sits between the chat frontend and LLM backends, exposing an Anthropic-compatible API.

## Project Structure

```
src/
  action/         Action dispatcher + pluggable adapters (delivery, memory, event bus) + retry queue
  card-import/    ST Card V2 parser (PNG tEXt chunk + JSON) and workspace mapper
  coordinator/    Request pipeline, mutex, prompt assembler, System 1 client + templates
  emotion/        Emotion calculator (6-dimension decay model) + narrative generator
  impulse/        Impulse calculator + behavior decision engine (reply/suppress/hesitate)
  server/         Hono API server — Anthropic-compatible /v1/messages, /health, /debug
  storage/        SQLite (chat history, WI entries), emotion state (Markdown), metrics (JSONL)
  types/          Shared TypeScript types — emotions, actions, triggers, WI, config
  wi-engine/      World Info activation — text scanner, pre-filter, 4-signal scoring
embedding-proxy/  Standalone embedding proxy service (port 8098)
```

## Install

```bash
npm install
cd embedding-proxy && npm install
```

## Run

```bash
npm run dev          # dev server with hot reload (tsx watch)
npm run build        # compile TypeScript
npm start            # run compiled output
```

## Test

```bash
npm test             # vitest run (single pass)
npm run typecheck    # tsc --noEmit
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ALAN_PORT` | `7088` | API server port |
| `ALAN_WORKSPACE` | `/home/node/.openclaw/workspace` | Workspace directory path |
| `ALAN_S1_BASE_URL` | `http://127.0.0.1:8080` | System 1 LLM gateway URL |
| `ALAN_S2_BASE_URL` | `http://127.0.0.1:8080` | System 2 LLM gateway URL |
| `ALAN_S1_MODEL` | `gemini-2.5-flash` | System 1 model name |
| `ALAN_S2_MODEL` | `claude-opus-4-6` | System 2 model name |
| `ALAN_EMBEDDING_URL` | `http://127.0.0.1:8080` | Embedding proxy URL |
| `ALAN_EVENT_BUS_URL` | _(empty)_ | Event Bus URL (Phase 6) |
| `ALAN_EVENT_BUS_KEY` | _(empty)_ | Event Bus API key |
| `ALAN_AGENT_ID` | `alan-default` | Agent identifier |
| `ALAN_FIRE_THRESHOLD` | `0.6` | Impulse fire threshold |
| `ALAN_USER_MSG_INCREMENT` | `0.1` | Impulse increment per user message |
| `ALAN_SESSION_TIMEOUT_HOURS` | `4` | Session timeout |
| `ALAN_WI_THRESHOLD` | `0.5` | WI activation threshold |

## Status

Phase 0 complete. All modules are built and wired together. System 1/2 LLM calls use placeholder/mock implementations — real LLM integration is Phase 1. Event Bus is Phase 6.
