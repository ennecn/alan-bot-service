# LLM Gateway System Architecture & Bot Deployment Guide

## 1. System Overview (LLM Gateway)

The **LLM Gateway** is a centralized Node.js proxy server running on the Mac Mini Host (Port `8080`). It acts as the unified entry point for all OpenClaw bots, providing stability, fallback mechanisms, and protocol translation.

### Core Functions
*   **Unified Endpoint**: All bots connect to this gateway instead of connecting directly to API providers.
*   **Smart Fallback**: Automatically reroutes requests when the primary provider fails (e.g., due to rate limits or downtime).
*   **Protocol Translation (Streaming)**:
    *   OpenClaw bots expect **Anthropic-format** Server-Sent Events (SSE).
    *   Fallback providers (Kimi, NVIDIA) often output **OpenAI-format** streams.
    *   The Gateway performs **real-time stream conversion**, parsing OpenAI chunks and emitting Anthropic `content_block_delta` events, ensuring bots continue typing smoothly even when using non-Anthropic backends.
*   **Health Monitoring**: Tracks provider health. If a provider fails multiple times, it is temporarily marked as "exhausted" to prevent latency accumulation.
*   **Scheduled Recovery**: Automatically resets the health status of primary providers (like Codesome) at **00:00 Beijing Time** daily.

### Model Routing Logic
The Gateway routes requests based on the model name and provider availability:

1.  **Primary**: **Codesome** (High-quality Anthropic wrapper).
2.  **Fallback Tier 1**: **Moonshot AI (Kimi)** (via OpenAI-compatible API).
3.  **Fallback Tier 2**: **NVIDIA API** (via OpenAI-compatible API).
4.  **Special Routing**:
    *   Models tagged for image generation (e.g., `gemini-3-pro-image`) are routed to **Antigravity** (Port `8045`).

---

## 2. Bot Deployment Architecture

There are **4 Active Bots**, all running in Docker containers on the Mac Mini.

| Bot Name | Telegram Handle | Container Name | Internal Port | Local Proxy Port |
| :--- | :--- | :--- | :--- | :--- |
| **Alin** (Windy) | `@windclaw_bot` | `deploy-openclaw-gateway-1` | `18789` | `8022` |
| **Lain** (Torrent) | `@TorrentClaw_bot` | `lain-gateway` | `18790` | `8023` |
| **Aling** (Thunder)| `@thunderopenclaw_bot`| `aling-gateway` | `18791` | `8024` |
| **Lumi** (Starlight)| `@StarlightClaw_bot` | `lumi-gateway` | `18792` | `8025` |

### Container Internals
Each bot container utilizes a **Sidecar Proxy Pattern** for maximum compatibility:

1.  **Local Proxy (`api-proxy.js`)**:
    *   Runs inside the container on port `8022`.
    *   Intercepts all outgoing LLM requests from the bot.
    *   Adds necessary authentication headers (`x-api-key`).
    *   Forwards the request to the **Mac Mini Gateway**.

2.  **Key Configuration Files**:
    *   `start.sh`: Exports `ANTHROPIC_BASE_URL="http://127.0.0.1:8022"`, forcing the bot to talk to the local proxy.
    *   `docker-compose.yml`: Contains the critical network configuration:
        ```yaml
        extra_hosts:
          - "host.docker.internal:host-gateway"
        ```
        This mapping allows the container to resolve `host.docker.internal` to the Mac Mini's IP address, establishing the bridge to the main Gateway.

---

## 3. Workflow Summary

1.  **Request**: Bot initiates a chat request to `http://127.0.0.1:8022`.
2.  **Intercept**: Local `api-proxy.js` receives it.
3.  **Forward**: Proxy forwards it to `http://host.docker.internal:8080` (Main Gateway).
4.  **Process**:
    *   Gateway checks **Codesome** health.
    *   **If Healthy**: Forwards request to Codesome.
    *   **If Error (429/500)**: Catches error, switches to **Kimi** (Tier 1).
    *   **If Kimi Fails**: Switches to **NVIDIA** (Tier 2).
5.  **Response**:
    *   If fallback is used, Gateway converts the incoming OpenAI stream into Anthropic format.
    *   Gateway pipes the formatted stream back to the Local Proxy.
    *   Local Proxy pipes it to the Bot.
6.  **Result**: Bot displays the generated text seamlessly, unaware of the provider switch.

---

## Appendix: OpenClaw Native Fallback Analysis

Based on code analysis of `https://github.com/openclaw/openclaw` (Files: `src/agents/model-fallback.ts`, `src/config/types.agent-defaults.ts`):

1.  **Native Capability**: OpenClaw **DOES** support model fallback natively.
2.  **Configuration**: It is **NOT** automatic for "Claude Code Max" or any specific plan. You must explicitly configure it in `config.yaml` or `config.json`:
    ```json
    {
      "agents": {
        "defaults": {
          "model": {
            "primary": "anthropic/claude-3-opus",
            "fallbacks": ["openai/gpt-4", "google/gemini-pro"]
          }
        }
      }
    }
    ```
3.  **Comparison**:
    *   **OpenClaw Native**: Requires client-side config. Retries at the *app level*.
    *   **Mac Mini Gateway (Current Setup)**: Handles fallback transparently at the *network level*. The Bot/OpenClaw thinks it's talking to one reliable endpoint (`http://127.0.0.1:8022`), while the Gateway handles the complexity of switching from Codesome to Kimi/Nvidia.
    *   **Recommendation**: Stick to the **Mac Mini Gateway** approach. It is more robust, centralized loggable, and handles protocol conversion (OpenAI -> Anthropic) which OpenClaw's native fallback might not handle seamlessly if providers have different APIs.

---

## Appendix: Model Routing & Complexity Analysis

The user inquired if OpenClaw supports **automatic model switching based on task complexity** (similar to "Claude Code" behavior where simple tasks use smaller models).

**Conclusion**:
1.  **No Native Complexity Router**: OpenClaw's code (`src/agents/model-selection.ts`) does **not** analyze prompt complexity to dynamically select a model (e.g., routing simple prompts to Haiku and complex ones to Opus).
2.  **Static Configuration**: Model selection is determined by:
    *   **Main Agent Config**: Fixed in `config.yaml`.
    *   **Sub-Agent Config**: Can be set to a different model (e.g., you can configure sub-agents to use a cheaper model), but this is a static choice, not dynamic per-prompt.
    *   **CLI Wrappers**: When using `claude-cli` via OpenClaw, OpenClaw defaults to passing `--model opus` unless overridden. It does not actively leverage the CLI's internal auto-selection if one exists.
3.  **Workaround**: To achieve efficient model usage, you would need to:
    *   Manually select models for specific agents (e.g., a "Researcher" agent uses Opus, a "Greeter" agent uses Haiku).
    *   Or use an upstream Gateway that implements semantic routing (analyzing the prompt before forwarding).
