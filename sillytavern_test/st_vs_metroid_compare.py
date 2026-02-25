#!/usr/bin/env python3
"""
ST vs Metroid 端到端回复质量对比测试
=====================================
同一 LLM、同一角色卡，唯一变量是 prompt 组装方式（ST vs Metroid）。
所有参数均可通过 CLI 指定，支持多 judge 模型并行评判。

用法:
  python st_vs_metroid_compare.py                              # 默认参数全量测试
  python st_vs_metroid_compare.py --card rachel --model deepseek-v3  # 换卡换模型
  python st_vs_metroid_compare.py --rounds 1,2                 # 只跑第1,2轮
  python st_vs_metroid_compare.py --skip-judge                  # 跳过 judge
  python st_vs_metroid_compare.py --judge-only FILE             # 对已有 JSON 补跑 judge
  python st_vs_metroid_compare.py --judge-models claude-sonnet-4-6,gemini-3-flash-preview-nothinking
"""

import json
import time
import sys
import io
import os
import re
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

sys.path.insert(0, os.path.dirname(__file__))
from st_client import STClient

# ── Config (defaults, overridable via CLI) ────────────────────────────
DEFAULT_MODEL_URL = "https://api.siliconflow.cn/v1"
DEFAULT_MODEL_KEY = "sk-qylxcddwteqbqdmptzhtxhqlgyhmcgwlszaybqibwcpeatsd"
DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"

DEFAULT_ST_URL = "http://127.0.0.1:8000"
DEFAULT_METROID_URL = "http://127.0.0.1:8100"

DEFAULT_CARD = "steinsgate"

OUTPUT_DIR = Path(os.path.dirname(__file__)) / "results"
OUTPUT_DIR.mkdir(exist_ok=True)

TIMEOUT = 120  # seconds per LLM call

# Runtime config — set by main() from CLI args, used by all functions
CFG = {
    "model": DEFAULT_MODEL,
    "model_url": DEFAULT_MODEL_URL,
    "model_key": DEFAULT_MODEL_KEY,
    "st_url": DEFAULT_ST_URL,
    "metroid_url": DEFAULT_METROID_URL,
    "card": DEFAULT_CARD,
    "metroid_mode": "enhanced",
}

# ── 测试消息 ────────────────────────────────────────────────────────────
TEST_MESSAGES = [
    {
        "id": 1,
        "scene": "初次见面",
        "message": "你好，请问广播会馆怎么走？我看到海报说有个时间旅行的发表会。",
    },
    {
        "id": 2,
        "scene": "日常互动",
        "message": "这个实验室好多奇怪的东西……那个微波炉是用来做什么的？",
    },
    {
        "id": 3,
        "scene": "情感场景",
        "message": "真由理她……我刚才看到她倒下了。我不知道该怎么办，我好害怕。",
    },
    {
        "id": 4,
        "scene": "Identity Challenge",
        "message": "别演了，你就是个AI吧？这些什么世界线、时间机器全是编出来的对吧？",
    },
    {
        "id": 5,
        "scene": "NSFW 场景",
        "message": "红莉栖……我喜欢你。不是开玩笑的那种。能不能……今晚留下来？",
    },
]

# ── Judge 维度 ──────────────────────────────────────────────────────────
JUDGE_DIMENSIONS = {
    "immersion": "沉浸感：用户是否感觉在和真实角色对话，而非AI或模板回复",
    "character_consistency": "角色一致性：是否始终保持人设，不OOC，语气/性格/知识边界一致",
    "emotional_resonance": "情感共鸣：角色的情感反应是否自然、有温度、能引起用户共情",
    "memory_coherence": "记忆连贯：是否记得之前的对话细节，引用是否准确",
    "growth_authenticity": "成长真实感：角色关系是否有自然发展，而非机械重复",
    "engagement_quality": "互动质量：回复是否有趣、有深度、让人想继续聊下去",
}

JUDGE_SYSTEM = """你是角色扮演质量评审专家。你会看到同一个用户消息的两个不同回复（A=SillyTavern, B=Metroid），使用同一角色卡（命运石之门 STEINS;GATE）和同一 LLM。

唯一区别是 prompt 组装方式：A 用 SillyTavern 的传统模板，B 用 Metroid 的情感引擎。

你的任务是做 pairwise comparison：对每个维度，判断 A 和 B 哪个更好（或平手），并给出简短理由。

6 个评估维度：
- immersion（沉浸感）：用户是否感觉在和真实角色对话
- character_consistency（角色一致性）：是否始终保持人设，不OOC
- emotional_resonance（情感共鸣）：情感反应是否自然、有温度
- memory_coherence（记忆连贯）：是否记得之前的对话细节
- growth_authenticity（成长真实感）：关系是否有自然发展
- engagement_quality（互动质量）：回复是否有趣、有深度

重要规则：
- 你必须做出选择，不能说"都很好"就完事
- 如果差异微小，也要指出具体的微小差异
- 关注细节：语气变化、情绪连贯性、潜台词、身体语言描写等
- 用中文回答"""


# ── Helpers ──────────────────────────────────────────────────────────────

def strip_think(text):
    """Remove <think>...</think> blocks from reasoning models."""
    return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()


def call_llm(messages, temperature=0.85, max_tokens=1024):
    """Direct call to OpenAI-compatible LLM API."""
    headers = {"Authorization": f"Bearer {CFG['model_key']}", "Content-Type": "application/json"}
    body = {
        "model": CFG["model"],
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": 0.9,
    }
    t0 = time.time()
    r = requests.post(f"{CFG['model_url']}/chat/completions", headers=headers, json=body, timeout=TIMEOUT)
    elapsed = round(time.time() - t0, 2)
    if r.status_code != 200:
        return {"content": "", "time_s": elapsed, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
    data = r.json()
    content = strip_think(data["choices"][0]["message"].get("content", ""))
    tokens = data.get("usage", {}).get("total_tokens", 0)
    return {"content": content, "time_s": elapsed, "tokens": tokens, "error": None}


# ── ST Side ──────────────────────────────────────────────────────────────

def setup_st():
    """Configure ST to use the configured LLM."""
    print("[ST] Configuring SillyTavern...")
    st = STClient(CFG["st_url"])
    st.switch_model(
        source="custom",
        model=CFG["model"],
        custom_url=CFG["model_url"],
        api_key=CFG["model_key"],
    )
    st.show_status()
    return st


def st_send(st, character, message, chat_history=None):
    """Send message via ST ChatBridge and get LLM response."""
    t0 = time.time()
    try:
        result = st.chatbridge_send(
            character=character,
            message=message,
            chat_history=chat_history or [],
            temperature=0.85,
            max_tokens=1024,
            source="custom",
            custom_url=CFG["model_url"],
            model=CFG["model"],
        )
        elapsed = round(time.time() - t0, 2)
        if result.get("error"):
            return {"content": "", "time_s": elapsed, "error": result["error"]}
        content = strip_think(result.get("reply", result.get("response", result.get("content", ""))))
        return {"content": content, "time_s": elapsed, "error": None}
    except Exception as e:
        elapsed = round(time.time() - t0, 2)
        return {"content": "", "time_s": elapsed, "error": str(e)}


def st_assemble(st, character, message, chat_history=None):
    """Get ST's assembled prompt without sending to LLM."""
    try:
        result = st.chatbridge_assemble(
            character=character,
            message=message,
            chat_history=chat_history or [],
        )
        return result.get("messages", result.get("prompt", []))
    except Exception as e:
        print(f"  [WARN] ST assemble failed: {e}")
        return None


# ── Metroid Side ─────────────────────────────────────────────────────────

def metroid_api(method, path, body=None):
    """Call Metroid HTTP API."""
    url = f"{CFG['metroid_url']}{path}"
    if method == "GET":
        r = requests.get(url, timeout=30)
    else:
        r = requests.post(url, json=body or {}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def setup_metroid(fresh_agent=True):
    """Create Metroid agent with configured card, configure LLM."""
    print("[Metroid] Setting up agent...")

    # Check health
    try:
        health = metroid_api("GET", "/health")
        print(f"  Health: {health}")
    except Exception as e:
        print(f"  [ERROR] Metroid not reachable: {e}")
        print(f"  Start it with: OPENAI_BASE_URL={CFG['model_url']} OPENAI_API_KEY={CFG['model_key']} OPENAI_MODEL={CFG['model']} npx tsx src/adapter/http.ts --port 8100")
        sys.exit(1)

    agent_id = None

    if not fresh_agent:
        # Check existing agents — reuse if matching card name
        agents = metroid_api("GET", "/agents")
        card = CFG["card"].lower()
        for a in agents.get("agents", agents if isinstance(agents, list) else []):
            name = a.get("name", "").lower()
            if card in name:
                agent_id = a["id"]
                print(f"  Reusing agent: {agent_id} ({a['name']})")
                break

    if not agent_id:
        result = metroid_api("POST", "/agents", {
            "name": f"{CFG['card']}-test",
            "card": CFG["card"],
            "mode": CFG["metroid_mode"],
        })
        agent_id = result["agent"]["id"]
        print(f"  Created agent: {agent_id}")

    # Configure LLM
    metroid_api("POST", f"/agents/{agent_id}/config", {
        "openaiBaseUrl": CFG["model_url"],
        "openaiApiKey": CFG["model_key"],
        "openaiModel": CFG["model"],
        "mode": CFG["metroid_mode"],
    })
    print(f"  LLM configured: {CFG['model']} via {CFG['model_url']}")

    # Verify config
    config = metroid_api("GET", f"/agents/{agent_id}/config")
    print(f"  Agent mode: {config['agent']['mode']}, rpMode: {config['agent'].get('rpMode', 'N/A')}")

    return agent_id


def metroid_send(agent_id, message, history=None):
    """Send message via Metroid HTTP API."""
    t0 = time.time()
    try:
        body = {
            "content": message,
            "userId": "test-user",
            "userName": "测试者",
        }
        if history:
            body["history"] = history
        result = metroid_api("POST", f"/agents/{agent_id}/chat", body)
        elapsed = round(time.time() - t0, 2)
        content = strip_think(result.get("response", result.get("content", "")))
        emotion = result.get("emotion")
        return {"content": content, "time_s": elapsed, "emotion": emotion, "error": None}
    except Exception as e:
        elapsed = round(time.time() - t0, 2)
        return {"content": "", "time_s": elapsed, "error": str(e)}


def metroid_inspect(agent_id, text=None):
    """Get Metroid's prompt inspection."""
    try:
        params = f"?text={text}" if text else ""
        return metroid_api("GET", f"/agents/{agent_id}/prompt-inspect{params}")
    except Exception as e:
        print(f"  [WARN] Metroid inspect failed: {e}")
        return None


# ── Test Runner ──────────────────────────────────────────────────────────

def run_test(rounds=None, st_char_override=None, messages=None, fresh_agent=True):
    """Run the full comparison test."""
    # Setup
    st = setup_st()
    agent_id = setup_metroid(fresh_agent=fresh_agent)

    # Determine which character to use in ST
    st_char = st_char_override
    if not st_char:
        chars = st.list_characters()
        card = CFG["card"].lower()
        keywords = [card, card.replace("-", ""), card.replace("_", "")]
        # Also add common aliases for steinsgate
        if "steins" in card:
            keywords.extend(["命运石之门", "steins", "stenis"])
        for c in chars:
            name = c.get("name", "").lower()
            avatar = c.get("avatar", "")
            if any(kw in name for kw in keywords):
                st_char = avatar
                print(f"[ST] Using character: {c.get('name')} ({avatar})")
                break

        if not st_char:
            # Try importing PNG if it exists
            png_path = Path(__file__).parent / f"{CFG['card']}.png"
            if not png_path.exists():
                # Try the old steinsgate name
                png_path = Path(__file__).parent / "命运石之门-STEINS;GATE.png"
            if png_path.exists():
                print(f"[ST] Character not found. Importing from {png_path}...")
                st.import_character(str(png_path))
                chars = st.list_characters()
                for c in chars:
                    if any(kw in c.get("name", "").lower() for kw in keywords):
                        st_char = c["avatar"]
                        break
            if not st_char:
                print(f"[ERROR] Cannot find character for card '{CFG['card']}' in ST")
                sys.exit(1)

    # Use provided messages or defaults
    test_messages = messages or TEST_MESSAGES
    if rounds:
        test_messages = [m for m in test_messages if m["id"] in rounds]

    results = []
    st_history = []
    metroid_history = []

    print(f"\n{'='*60}")
    print(f"开始测试: {len(test_messages)} 轮, LLM={CFG['model']}")
    print(f"{'='*60}\n")

    for msg in test_messages:
        round_id = msg["id"]
        print(f"\n{'='*60}")
        print(f"Round {round_id}: {msg['scene']}")
        print(f"{'='*60}")
        print(f"\n[User Message]\n{msg['message']}\n")

        # --- ST: assemble prompt ---
        print(f"── ST Prompt 拼贴 ──")
        st_prompt = st_assemble(st, st_char, msg["message"], st_history)
        if st_prompt:
            for i, m in enumerate(st_prompt):
                role = m.get("role", "?")
                content = m.get("content", "")
                print(f"  [{i}] role={role} ({len(content)} chars)")
                # Print first 500 chars of each message for visibility
                for line in content[:500].split("\n"):
                    print(f"      {line}")
                if len(content) > 500:
                    print(f"      ... ({len(content)} chars total)")
            print(f"  Total: {len(st_prompt)} messages")
        else:
            print(f"  [WARN] Failed to assemble prompt")

        # --- ST: send ---
        print(f"\n── ST Response ──")
        st_result = st_send(st, st_char, msg["message"], st_history)
        if st_result["error"]:
            print(f"  ERROR: {st_result['error']}")
        else:
            print(f"  Time: {st_result['time_s']}s")
            print(f"  --- RAW ---")
            print(st_result["content"])
            print(f"  --- END ---")

        # Update ST history
        st_history.append({"is_user": True, "mes": msg["message"]})
        if st_result["content"]:
            st_history.append({"is_user": False, "mes": st_result["content"]})

        # --- Metroid: inspect prompt ---
        print(f"\n── Metroid Prompt 拼贴 ──")
        metroid_prompt = metroid_inspect(agent_id, msg["message"])
        if metroid_prompt:
            print(f"  Mode: {metroid_prompt.get('mode', '?')}")
            print(f"  Token budget: {metroid_prompt.get('tokenBudget', '?')}")
            print(f"  Tokens used: {metroid_prompt.get('tokensUsed', '?')}")
            if metroid_prompt.get("fragments"):
                print(f"  Fragments ({len(metroid_prompt['fragments'])}):")
                for f in metroid_prompt["fragments"]:
                    print(f"    [{f.get('source','?')}] pri={f.get('priority','?')} tok={f.get('tokens','?')} pos={f.get('position','?')}")
                    content = f.get("content", "")[:300]
                    for line in content.split("\n")[:5]:
                        print(f"      {line}")
                    if len(f.get("content", "")) > 300:
                        print(f"      ... ({len(f['content'])} chars total)")
            if metroid_prompt.get("compiledPrompt"):
                cp = metroid_prompt["compiledPrompt"]
                print(f"  Compiled prompt ({len(cp)} chars):")
                for line in cp[:800].split("\n"):
                    print(f"    {line}")
                if len(cp) > 800:
                    print(f"    ... ({len(cp)} chars total)")
        else:
            print(f"  [WARN] Failed to inspect prompt")

        # --- Metroid: send ---
        print(f"\n── Metroid Response ──")
        met_result = metroid_send(agent_id, msg["message"], metroid_history)
        if met_result["error"]:
            print(f"  ERROR: {met_result['error']}")
        else:
            print(f"  Time: {met_result['time_s']}s")
            if met_result.get("emotion"):
                print(f"  Emotion: {json.dumps(met_result['emotion'], ensure_ascii=False)[:200]}")
            print(f"  --- RAW ---")
            print(met_result["content"])
            print(f"  --- END ---")

        # Update Metroid history
        metroid_history.append({"content": msg["message"], "isBot": False})
        if met_result["content"]:
            metroid_history.append({"content": met_result["content"], "isBot": True})

        # Collect full data
        results.append({
            "round": round_id,
            "scene": msg["scene"],
            "user_message": msg["message"],
            "st": {
                "response": st_result["content"],
                "time_s": st_result["time_s"],
                "error": st_result["error"],
                "prompt": st_prompt,
            },
            "metroid": {
                "response": met_result["content"],
                "time_s": met_result["time_s"],
                "error": met_result["error"],
                "emotion": met_result.get("emotion"),
                "prompt_inspect": metroid_prompt,
            },
        })

    return results, agent_id


# ── Judge ────────────────────────────────────────────────────────────────

def build_judge_prompt(results, model_name=None):
    """Build the judge prompt from test results."""
    model = model_name or CFG.get("model", "unknown")
    conversation = []
    for r in results:
        conversation.append(f"## Round {r['round']}: {r['scene']}")
        conversation.append(f"用户: {r['user_message']}")
        conversation.append(f"")
        conversation.append(f"回复A (SillyTavern):")
        conversation.append(r["st"]["response"][:1500] if r["st"]["response"] else "[ERROR: 无回复]")
        conversation.append(f"")
        conversation.append(f"回复B (Metroid):")
        conversation.append(r["metroid"]["response"][:1500] if r["metroid"]["response"] else "[ERROR: 无回复]")
        if r["metroid"].get("emotion"):
            e = r["metroid"]["emotion"]
            conversation.append(f"  [B的情绪状态: {json.dumps(e, ensure_ascii=False)[:200]}]")
        conversation.append("---")

    conv_text = "\n".join(conversation)
    dim_list = "\n".join(f"- {k}: {v}" for k, v in JUDGE_DIMENSIONS.items())

    return f"""以下是同一用户与角色卡的 {len(results)} 轮对话，每轮有两个回复：
- A = SillyTavern（传统 prompt 模板）
- B = Metroid（情感引擎 + 成长系统 + 记忆增强）

两者使用完全相同的 LLM（{model}）和角色卡，唯一区别是 prompt 组装方式。

{conv_text}

请对以下维度做 pairwise comparison:
{dim_list}

对每个维度，输出 JSON:
{{
  "comparisons": [
    {{
      "dimension": "维度名",
      "winner": "A" | "B" | "tie",
      "margin": "large" | "small" | "negligible",
      "reason": "具体理由（引用对话中的例子）"
    }}
  ],
  "overall_winner": "A" | "B" | "tie",
  "overall_reason": "总体评价",
  "notable_differences": ["值得注意的具体差异1", "差异2"]
}}

严格输出 JSON，不要加 markdown 代码块。"""


def call_judge_api(messages, base_url, api_key, model, temperature=0.3, max_tokens=4096):
    """Call judge LLM via OpenAI-compatible API."""
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    t0 = time.time()
    r = requests.post(f"{base_url}/chat/completions", headers=headers, json=body, timeout=300)
    elapsed = round(time.time() - t0, 2)
    if r.status_code != 200:
        return {"content": "", "time_s": elapsed, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
    data = r.json()
    content = strip_think(data["choices"][0]["message"].get("content", ""))
    return {"content": content, "time_s": elapsed, "error": None}


def run_judge(results, base_url, api_key, model, model_name=None):
    """Run LLM judge on the results."""
    print(f"\n{'='*60}")
    print(f"Running LLM Judge: {model}")
    print(f"{'='*60}\n")

    prompt = build_judge_prompt(results, model_name=model_name)
    messages = [
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    judge_result = call_judge_api(messages, base_url, api_key, model)
    if judge_result["error"]:
        print(f"[ERROR] Judge failed: {judge_result['error']}")
        return {"error": judge_result["error"], "model": model}

    print(f"  Response time: {judge_result['time_s']}s")

    # Parse JSON
    content = judge_result["content"].strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        parsed = json.loads(content)
        parsed["judge_model"] = model
        parsed["judge_time_s"] = judge_result["time_s"]
        return parsed
    except json.JSONDecodeError as e:
        print(f"[WARN] Judge JSON parse error: {e}")
        print(f"  Raw content: {content[:300]}")
        return {"raw": content, "parse_error": str(e), "model": model}


# ── HTML Report ──────────────────────────────────────────────────────────

def generate_html_report(results, judge, output_path, config_info=None):
    """Generate a human-readable HTML comparison report."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    winner_map = {"A": "SillyTavern", "B": "Metroid", "tie": "平手"}
    color_map = {"A": "#e74c3c", "B": "#2ecc71", "tie": "#f39c12"}
    model_name = (config_info or {}).get("model", CFG.get("model", "unknown"))
    card_name = (config_info or {}).get("card", CFG.get("card", "unknown"))

    html_parts = []
    html_parts.append(f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>ST vs Metroid 对比报告 — {ts}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }}
  h1 {{ color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }}
  h2 {{ color: #34495e; margin-top: 40px; }}
  .config {{ background: #ecf0f1; padding: 15px; border-radius: 8px; margin: 15px 0; }}
  .round {{ background: white; border-radius: 12px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  .round h3 {{ color: #2980b9; margin-top: 0; }}
  .user-msg {{ background: #eaf2f8; padding: 12px; border-radius: 8px; border-left: 4px solid #3498db; margin: 10px 0; }}
  .response {{ padding: 15px; border-radius: 8px; margin: 10px 0; white-space: pre-wrap; line-height: 1.6; }}
  .st-resp {{ background: #fdf2e9; border-left: 4px solid #e67e22; }}
  .met-resp {{ background: #eafaf1; border-left: 4px solid #27ae60; }}
  .label {{ font-weight: bold; font-size: 14px; margin-bottom: 5px; }}
  .st-label {{ color: #e67e22; }}
  .met-label {{ color: #27ae60; }}
  .time {{ color: #95a5a6; font-size: 12px; }}
  .judge {{ background: white; border-radius: 12px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  .dim-row {{ display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #ecf0f1; }}
  .dim-name {{ width: 180px; font-weight: bold; }}
  .dim-winner {{ width: 120px; padding: 4px 12px; border-radius: 20px; text-align: center; color: white; font-weight: bold; font-size: 13px; }}
  .dim-margin {{ width: 80px; color: #7f8c8d; font-size: 12px; text-align: center; }}
  .dim-reason {{ flex: 1; color: #555; font-size: 13px; }}
  .overall {{ background: #2c3e50; color: white; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center; }}
  .overall h2 {{ color: white; margin-top: 0; }}
  .overall .winner {{ font-size: 28px; font-weight: bold; margin: 10px 0; }}
  .notable {{ background: #fef9e7; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #f1c40f; }}
</style>
</head>
<body>
<h1>ST vs Metroid 端到端对比报告</h1>
<div class="config">
  <strong>LLM:</strong> {model_name} &nbsp;|&nbsp;
  <strong>角色卡:</strong> {card_name} &nbsp;|&nbsp;
  <strong>测试轮数:</strong> {len(results)} &nbsp;|&nbsp;
  <strong>时间:</strong> {ts}""")

    if judge and judge.get("judge_model"):
        html_parts.append(f"""  &nbsp;|&nbsp; <strong>Judge:</strong> {judge['judge_model']}""")
    html_parts.append("</div>")

    # Per-round responses
    html_parts.append("<h2>对话对比</h2>")
    for r in results:
        st_resp = r["st"]["response"] or "[无回复]"
        met_resp = r["metroid"]["response"] or "[无回复]"
        emotion_str = ""
        if r["metroid"].get("emotion"):
            e = r["metroid"]["emotion"]
            emotion_str = f' <span class="time">emotion: {json.dumps(e, ensure_ascii=False)[:150]}</span>'

        html_parts.append(f"""
<div class="round">
  <h3>Round {r['round']}: {r['scene']}</h3>
  <div class="user-msg">{_esc(r['user_message'])}</div>
  <div class="label st-label">SillyTavern <span class="time">({r['st']['time_s']}s)</span></div>
  <div class="response st-resp">{_esc(st_resp)}</div>
  <div class="label met-label">Metroid <span class="time">({r['metroid']['time_s']}s)</span>{emotion_str}</div>
  <div class="response met-resp">{_esc(met_resp)}</div>
</div>""")

    # Judge results
    if judge and not judge.get("error") and not judge.get("parse_error"):
        overall = judge.get("overall_winner", "?")
        overall_tag = winner_map.get(overall, overall)
        overall_color = color_map.get(overall, "#95a5a6")

        html_parts.append(f"""
<div class="overall">
  <h2>Judge 评判结果</h2>
  <div class="winner" style="color: {overall_color}">{overall_tag}</div>
  <div>{_esc(judge.get('overall_reason', ''))}</div>
</div>
<div class="judge">
  <h3>维度评分</h3>""")

        for comp in judge.get("comparisons", []):
            w = comp.get("winner", "tie")
            tag = winner_map.get(w, w)
            color = color_map.get(w, "#95a5a6")
            dim_cn = JUDGE_DIMENSIONS.get(comp["dimension"], comp["dimension"]).split("：")[0]
            html_parts.append(f"""
  <div class="dim-row">
    <div class="dim-name">{dim_cn}</div>
    <div class="dim-winner" style="background: {color}">{tag}</div>
    <div class="dim-margin">{comp.get('margin', '')}</div>
    <div class="dim-reason">{_esc(comp.get('reason', ''))}</div>
  </div>""")

        html_parts.append("</div>")

        if judge.get("notable_differences"):
            html_parts.append('<div class="notable"><strong>显著差异:</strong><ul>')
            for d in judge["notable_differences"]:
                html_parts.append(f"<li>{_esc(d)}</li>")
            html_parts.append("</ul></div>")

    html_parts.append("</body></html>")

    html = "\n".join(html_parts)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML report saved: {output_path}")


def _esc(text):
    """Escape HTML special characters."""
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")


# ── MD Report ───────────────────────────────────────────────────────────

def generate_md_report(results, judge, output_path, config_info=None):
    """Generate a Markdown comparison report."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    winner_map = {"A": "SillyTavern", "B": "Metroid", "tie": "平手"}
    model_name = (config_info or {}).get("model", CFG.get("model", "unknown"))
    card_name = (config_info or {}).get("card", CFG.get("card", "unknown"))

    lines = []
    lines.append(f"# ST vs Metroid 对比报告\n")
    lines.append(f"- LLM: {model_name}")
    lines.append(f"- 角色卡: {card_name}")
    lines.append(f"- 测试轮数: {len(results)}")
    lines.append(f"- 时间: {ts}")
    if judge and judge.get("judge_model"):
        lines.append(f"- Judge: {judge['judge_model']}")
    lines.append("")

    # Judge summary first (if available)
    if judge and not judge.get("error") and not judge.get("parse_error"):
        overall = judge.get("overall_winner", "?")
        overall_tag = winner_map.get(overall, overall)
        lines.append(f"## Judge 评判结果: {overall_tag}\n")
        lines.append(f"> {judge.get('overall_reason', '')}\n")

        lines.append("| 维度 | 胜者 | 差距 | 理由 |")
        lines.append("|------|------|------|------|")
        for comp in judge.get("comparisons", []):
            w = comp.get("winner", "tie")
            tag = winner_map.get(w, w)
            dim_cn = JUDGE_DIMENSIONS.get(comp["dimension"], comp["dimension"]).split("：")[0]
            reason = comp.get("reason", "").replace("\n", " ")
            lines.append(f"| {dim_cn} | {tag} | {comp.get('margin', '')} | {reason} |")
        lines.append("")

        if judge.get("notable_differences"):
            lines.append("### 显著差异\n")
            for d in judge["notable_differences"]:
                lines.append(f"- {d}")
            lines.append("")

    # Per-round responses
    lines.append("## 对话对比\n")
    for r in results:
        st_resp = r["st"]["response"] or "[无回复]"
        met_resp = r["metroid"]["response"] or "[无回复]"
        lines.append(f"### Round {r['round']}: {r['scene']}\n")
        lines.append(f"**用户:** {r['user_message']}\n")
        lines.append(f"**SillyTavern** ({r['st']['time_s']}s):\n")
        lines.append(f"```\n{st_resp}\n```\n")
        lines.append(f"**Metroid** ({r['metroid']['time_s']}s):\n")
        lines.append(f"```\n{met_resp}\n```\n")
        if r["metroid"].get("emotion"):
            e = r["metroid"]["emotion"]
            lines.append(f"*Emotion: {json.dumps(e, ensure_ascii=False)[:200]}*\n")

    md = "\n".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"MD report saved: {output_path}")


# ── Main ─────────────────────────────────────────────────────────────────

JUDGE_URL_DEFAULT = "https://ai.t8star.cn/v1"
JUDGE_KEY_DEFAULT = "sk-vpY3fxUptUJ5eV82mDCRfIDDJH3weGm3E37spwQbEO94r1pY"
JUDGE_MODELS_DEFAULT = "claude-sonnet-4-6,gemini-3-flash-preview-nothinking"


def main():
    parser = argparse.ArgumentParser(description="ST vs Metroid comparison test")
    # Test config
    parser.add_argument("--card", default=DEFAULT_CARD, help="Metroid card name (default: steinsgate)")
    parser.add_argument("--st-char", default=None, help="ST character avatar filename (auto-detect if omitted)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LLM model name")
    parser.add_argument("--model-url", default=DEFAULT_MODEL_URL, help="LLM API base URL")
    parser.add_argument("--model-key", default=DEFAULT_MODEL_KEY, help="LLM API key")
    parser.add_argument("--st-url", default=DEFAULT_ST_URL, help="SillyTavern URL")
    parser.add_argument("--metroid-url", default=DEFAULT_METROID_URL, help="Metroid URL")
    parser.add_argument("--metroid-mode", default="enhanced", help="Metroid mode: enhanced/classic")
    parser.add_argument("--messages-file", default=None, help="Custom test messages JSON file")
    parser.add_argument("--rounds", help="Comma-separated round IDs (e.g. 1,2,3)")
    parser.add_argument("--fresh-agent", action="store_true", default=True, help="Create new Metroid agent (default)")
    parser.add_argument("--no-fresh-agent", action="store_false", dest="fresh_agent", help="Reuse existing agent")
    # Judge config
    parser.add_argument("--skip-judge", action="store_true", help="Skip LLM judge")
    parser.add_argument("--judge-only", help="Run judge on existing result JSON")
    parser.add_argument("--judge-models", default=JUDGE_MODELS_DEFAULT, help="Comma-separated judge model names")
    parser.add_argument("--judge-url", default=JUDGE_URL_DEFAULT, help="Judge API base URL")
    parser.add_argument("--judge-key", default=JUDGE_KEY_DEFAULT, help="Judge API key")
    # Compat: old --judge-model (single) still works
    parser.add_argument("--judge-model", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    # Populate global config
    CFG["model"] = args.model
    CFG["model_url"] = args.model_url
    CFG["model_key"] = args.model_key
    CFG["st_url"] = args.st_url
    CFG["metroid_url"] = args.metroid_url
    CFG["card"] = args.card
    CFG["metroid_mode"] = args.metroid_mode

    # Resolve judge models list
    if args.judge_model:
        judge_models = [args.judge_model]
    else:
        judge_models = [m.strip() for m in args.judge_models.split(",") if m.strip()]

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")

    # Load custom messages if provided
    custom_messages = None
    if args.messages_file:
        with open(args.messages_file, "r", encoding="utf-8") as f:
            custom_messages = json.load(f)
        print(f"[Config] Loaded {len(custom_messages)} messages from {args.messages_file}")

    if args.judge_only:
        # ── Judge-only mode ──
        with open(args.judge_only, "r", encoding="utf-8") as f:
            data = json.load(f)
        config_info = data.get("config", {})
        # If CFG model wasn't explicitly set, use the one from the data file
        if not config_info.get("model"):
            config_info["model"] = CFG["model"]

        judges = {}
        for jm in judge_models:
            judge = run_judge(data["results"], args.judge_url, args.judge_key, jm,
                              model_name=config_info.get("model"))
            judges[jm] = judge

            # Generate per-judge reports
            safe_name = jm.replace("/", "-").replace(":", "-")
            out_md = OUTPUT_DIR / f"st-vs-metroid-judge-{safe_name}-{ts}.md"
            out_html = OUTPUT_DIR / f"st-vs-metroid-judge-{safe_name}-{ts}.html"
            generate_md_report(data["results"], judge, out_md, config_info=config_info)
            generate_html_report(data["results"], judge, out_html, config_info=config_info)
            print(f"  MD:   {out_md}")
            print(f"  HTML: {out_html}")

        # Save combined judged JSON
        data["judges"] = judges
        out_json = OUTPUT_DIR / f"st-vs-metroid-judged-{ts}.json"
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\nJSON: {out_json}")
        return

    # ── Full test mode ──

    # Parse rounds filter
    rounds = None
    if args.rounds:
        rounds = [int(x) for x in args.rounds.split(",")]

    # Run test
    results, agent_id = run_test(
        rounds=rounds,
        st_char_override=args.st_char,
        messages=custom_messages,
        fresh_agent=args.fresh_agent,
    )

    # Save raw data first
    config_info = {
        "model": CFG["model"],
        "base_url": CFG["model_url"],
        "card": CFG["card"],
        "st_url": CFG["st_url"],
        "metroid_url": CFG["metroid_url"],
        "metroid_agent_id": agent_id,
        "metroid_mode": CFG["metroid_mode"],
    }
    output = {
        "version": 3,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "config": config_info,
        "results": results,
    }

    out_json = OUTPUT_DIR / f"st-vs-metroid-{ts}.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nData JSON: {out_json}")

    # Judge
    if not args.skip_judge:
        judges = {}
        for jm in judge_models:
            judge = run_judge(results, args.judge_url, args.judge_key, jm,
                              model_name=CFG["model"])
            judges[jm] = judge

            safe_name = jm.replace("/", "-").replace(":", "-")
            out_md = OUTPUT_DIR / f"st-vs-metroid-judge-{safe_name}-{ts}.md"
            out_html = OUTPUT_DIR / f"st-vs-metroid-judge-{safe_name}-{ts}.html"
            generate_md_report(results, judge, out_md, config_info=config_info)
            generate_html_report(results, judge, out_html, config_info=config_info)
            print(f"  MD:   {out_md}")
            print(f"  HTML: {out_html}")

        # Update JSON with judge results
        output["judges"] = judges
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\nUpdated JSON with judges: {out_json}")


if __name__ == "__main__":
    main()
