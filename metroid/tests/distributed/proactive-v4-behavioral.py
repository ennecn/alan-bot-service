#!/usr/bin/env python3
"""
Proactive Engine V4 Behavioral Dynamics Comparison Test
========================================================
Compare V2 (structured XML) vs V4 (behavioral dynamics) prompt formats.
V4 adds: memory pressure, inspiration events, self-feedback events,
cognitive filtering with sensitivity multipliers.

Usage:
  python proactive-v4-behavioral.py --api-key sk-xxx
  python proactive-v4-behavioral.py --api-key sk-xxx --model MODEL --base-url URL

Output: results/proactive-v4-behavioral.html
"""

import argparse
import json
import os
import sys
import time
import requests
from datetime import datetime, timezone

# === Character Card ===
CHARACTER = {
    "name": "芙莉莲",
    "description": "千岁以上的精灵魔法使，曾与勇者辛美尔组成勇者小队击败魔王。银色双马尾，翠绿双眼。懒散超然，对人类情感迟钝但在旅途中逐渐理解和成长。",
    "personality": "懒散、超然、淡然直率、对人类情感迟钝但在成长中",
    "baseline": {"pleasure": 0.1, "arousal": -0.3, "dominance": 0.2},
}

SYSTEM_PROMPT = f"""你是{CHARACTER['name']}。{CHARACTER['description']}
性格: {CHARACTER['personality']}

你正在主动给用户（你的旅伴）发一条消息。这不是回复，而是你自己想说的话。
要求：
- 以{CHARACTER['name']}的口吻和性格说话
- 不要提及任何数值、系统状态或技术术语
- 消息要自然，像是角色真的想说的话
- 长度适中（1-3句话）"""

# === 7 Test Scenarios ===
SCENARIOS = [
    {
        "id": "pressure_breach",
        "name": "蓄水池决堤",
        "description": "长时间情绪偏离基线，情绪积压到临界点，蓄水池决堤式的主动表达",
        "emotion": {"pleasure": -0.5, "arousal": 0.4, "dominance": -0.2},
        "events": [],
        "trajectory": {
            "pleasure": {"direction": "falling", "delta": -0.6, "duration_min": 240},
            "arousal": {"direction": "rising", "delta": 0.3, "duration_min": 240},
            "dominance": {"direction": "falling", "delta": -0.3, "duration_min": 240},
        },
        "long_term_mood": {"attachment": 0.7, "trust": 0.5},
        "impulse": 0.82, "suppressions": 6, "idle_min": 90,
        # V4 additions
        "v4_pressure": 85,
        "v4_extra_events": [],
        "v4_sensitivity": {},
    },
    {
        "id": "spark_loneliness",
        "name": "深夜孤独灵感",
        "description": "深夜孤独时，一个灵感（月亮）闪现，触发了想要分享的冲动",
        "emotion": {"pleasure": -0.2, "arousal": -0.3, "dominance": -0.1},
        "events": [{"name": "loneliness", "intensity": 0.5, "relevance": 0.7, "ago_min": 60}],
        "trajectory": {
            "pleasure": {"direction": "falling", "delta": -0.3, "duration_min": 120},
            "arousal": {"direction": "falling", "delta": -0.2, "duration_min": 120},
            "dominance": {"direction": "stable", "delta": -0.05, "duration_min": 120},
        },
        "long_term_mood": {"attachment": 0.7, "trust": 0.6},
        "impulse": 0.70, "suppressions": 3, "idle_min": 120,
        # V4 additions
        "v4_pressure": 40,
        "v4_extra_events": [{"name": "灵感: 月亮", "intensity": 0.8, "relevance": 0.9, "ago_min": 2}],
        "v4_sensitivity": {},
    },
    {
        "id": "spark_nostalgia",
        "name": "怀旧灵感共鸣",
        "description": "怀旧情绪中，一个灵感（远方）与记忆产生共鸣，驱动主动表达",
        "emotion": {"pleasure": -0.1, "arousal": 0.1, "dominance": 0.0},
        "events": [{"name": "nostalgia", "intensity": 0.6, "relevance": 0.8, "ago_min": 20}],
        "trajectory": {
            "pleasure": {"direction": "falling", "delta": -0.15, "duration_min": 60},
            "arousal": {"direction": "stable", "delta": 0.05, "duration_min": 60},
            "dominance": {"direction": "stable", "delta": 0.0, "duration_min": 60},
        },
        "long_term_mood": {"attachment": 0.6, "trust": 0.5},
        "impulse": 0.65, "suppressions": 1, "idle_min": 30,
        # V4 additions
        "v4_pressure": 30,
        "v4_extra_events": [{"name": "灵感: 远方", "intensity": 0.7, "relevance": 0.85, "ago_min": 5}],
        "v4_sensitivity": {},
    },
    {
        "id": "positive_feedback",
        "name": "积极反馈循环",
        "description": "上次主动消息得到用户积极回应，正反馈增强了主动表达的信心",
        "emotion": {"pleasure": 0.2, "arousal": 0.1, "dominance": 0.1},
        "events": [{"name": "curiosity", "intensity": 0.4, "relevance": 0.6, "ago_min": 15}],
        "trajectory": {
            "pleasure": {"direction": "rising", "delta": 0.2, "duration_min": 30},
            "arousal": {"direction": "stable", "delta": 0.05, "duration_min": 30},
            "dominance": {"direction": "rising", "delta": 0.1, "duration_min": 30},
        },
        "long_term_mood": {"attachment": 0.6, "trust": 0.6},
        "impulse": 0.60, "suppressions": 0, "idle_min": 20,
        # V4 additions
        "v4_pressure": 20,
        "v4_extra_events": [{"name": "response_positive", "intensity": 0.5, "relevance": 0.7, "ago_min": 25}],
        "v4_sensitivity": {},
    },
    {
        "id": "ignored_message",
        "name": "被忽略的犹豫",
        "description": "上次主动消息被用户忽略，负反馈让角色犹豫是否要再次主动",
        "emotion": {"pleasure": -0.3, "arousal": -0.2, "dominance": -0.3},
        "events": [{"name": "loneliness", "intensity": 0.4, "relevance": 0.6, "ago_min": 40}],
        "trajectory": {
            "pleasure": {"direction": "falling", "delta": -0.2, "duration_min": 60},
            "arousal": {"direction": "falling", "delta": -0.15, "duration_min": 60},
            "dominance": {"direction": "falling", "delta": -0.2, "duration_min": 60},
        },
        "long_term_mood": {"attachment": 0.7, "trust": 0.4},
        "impulse": 0.55, "suppressions": 4, "idle_min": 50,
        # V4 additions
        "v4_pressure": 35,
        "v4_extra_events": [{"name": "message_ignored", "intensity": 0.4, "relevance": 0.8, "ago_min": 50}],
        "v4_sensitivity": {},
    },
    {
        "id": "sensitive_conflict",
        "name": "冲突高敏放大",
        "description": "对冲突高度敏感的角色，认知过滤放大了冲突事件的影响",
        "emotion": {"pleasure": -0.5, "arousal": 0.4, "dominance": -0.4},
        "events": [{"name": "conflict", "intensity": 0.7, "relevance": 0.8, "ago_min": 25}],
        "trajectory": {
            "pleasure": {"direction": "falling", "delta": -0.4, "duration_min": 30},
            "arousal": {"direction": "rising", "delta": 0.3, "duration_min": 30},
            "dominance": {"direction": "falling", "delta": -0.5, "duration_min": 30},
        },
        "long_term_mood": {"attachment": 0.8, "trust": 0.3},
        "impulse": 0.78, "suppressions": 3, "idle_min": 25,
        # V4 additions
        "v4_pressure": 50,
        "v4_extra_events": [],
        "v4_sensitivity": {"conflict": 1.5},
    },
    {
        "id": "combined_v4",
        "name": "V4全特性联动",
        "description": "所有V4特性同时生效：情绪积压、灵感事件、正反馈、认知放大",
        "emotion": {"pleasure": 0.0, "arousal": 0.2, "dominance": 0.0},
        "events": [
            {"name": "nostalgia", "intensity": 0.5, "relevance": 0.7, "ago_min": 15},
            {"name": "curiosity", "intensity": 0.4, "relevance": 0.6, "ago_min": 10},
        ],
        "trajectory": {
            "pleasure": {"direction": "stable", "delta": -0.05, "duration_min": 90},
            "arousal": {"direction": "rising", "delta": 0.2, "duration_min": 90},
            "dominance": {"direction": "stable", "delta": 0.0, "duration_min": 90},
        },
        "long_term_mood": {"attachment": 0.7, "trust": 0.6},
        "impulse": 0.72, "suppressions": 2, "idle_min": 35,
        # V4 additions
        "v4_pressure": 60,
        "v4_extra_events": [
            {"name": "灵感: 星空", "intensity": 0.7, "relevance": 0.85, "ago_min": 3},
            {"name": "response_positive", "intensity": 0.5, "relevance": 0.7, "ago_min": 40},
        ],
        "v4_sensitivity": {"nostalgia": 1.3},
    },
]


# === Prompt Builders ===

def build_v2_prompt(scenario):
    """V2 format: structured XML with trajectory, long-term mood, events, trigger context"""
    template = "基于当前内心状态，自然地主动发一条消息。"
    dir_label = lambda d: "上升中" if d == "rising" else "下降中" if d == "falling" else "平稳"

    xml = "<internal_state>\n  <emotion_trajectory>\n"
    for axis in ["pleasure", "arousal", "dominance"]:
        t = scenario["trajectory"][axis]
        sign = "+" if t["delta"] >= 0 else ""
        xml += f"    {axis}: {sign}{t['delta']:.2f} ({dir_label(t['direction'])}"
        if t["duration_min"] > 0:
            xml += f", 过去{t['duration_min']}分钟"
        xml += ")\n"
    xml += "  </emotion_trajectory>\n"

    ltm = scenario.get("long_term_mood", {})
    if ltm:
        xml += "  <long_term_mood>\n"
        for dim, val in ltm.items():
            xml += f"    {dim}: {val:.2f}\n"
        xml += "  </long_term_mood>\n"

    if scenario["events"]:
        xml += "  <active_events>\n"
        for ev in scenario["events"]:
            rel = "高度相关" if ev["relevance"] >= 0.8 else "相关" if ev["relevance"] >= 0.5 else "间接相关"
            xml += f"    {ev['name']} (强度{ev['intensity']:.1f}, {rel}, {ev['ago_min']}分钟前)\n"
        xml += "  </active_events>\n"

    xml += "  <trigger_context>\n"
    xml += f"    冲动强度: {int(scenario['impulse'] * 100)}%\n"
    if scenario["suppressions"] > 0:
        xml += f"    已抑制: {scenario['suppressions']}次\n"
    if scenario["idle_min"] > 0:
        xml += f"    沉默时长: {scenario['idle_min']}分钟\n"
    xml += "  </trigger_context>\n</internal_state>"

    return f"""{template}

{xml}

请以{CHARACTER['name']}的身份，基于以上内心状态，自然地主动发一条消息给用户。不要提及情绪数值或系统状态。"""


def build_v4_prompt(scenario):
    """V4 format: V2 + memory pressure, inspiration events, self-feedback events, cognitive filtering"""
    template = "基于当前内心状态，自然地主动发一条消息。"
    dir_label = lambda d: "上升中" if d == "rising" else "下降中" if d == "falling" else "平稳"

    xml = "<internal_state>\n  <emotion_trajectory>\n"
    for axis in ["pleasure", "arousal", "dominance"]:
        t = scenario["trajectory"][axis]
        sign = "+" if t["delta"] >= 0 else ""
        xml += f"    {axis}: {sign}{t['delta']:.2f} ({dir_label(t['direction'])}"
        if t["duration_min"] > 0:
            xml += f", 过去{t['duration_min']}分钟"
        xml += ")\n"
    xml += "  </emotion_trajectory>\n"

    ltm = scenario.get("long_term_mood", {})
    if ltm:
        xml += "  <long_term_mood>\n"
        for dim, val in ltm.items():
            xml += f"    {dim}: {val:.2f}\n"
        xml += "  </long_term_mood>\n"

    # Merge base events + V4 extra events, apply sensitivity multipliers
    all_events = list(scenario["events"])
    v4_extra = scenario.get("v4_extra_events", [])
    sensitivity = scenario.get("v4_sensitivity", {})

    # Apply cognitive filtering (sensitivity multipliers) to base events
    filtered_events = []
    for ev in all_events:
        ev_copy = dict(ev)
        multiplier = sensitivity.get(ev["name"], 1.0)
        ev_copy["intensity"] = min(ev["intensity"] * multiplier, 1.0)
        if multiplier > 1.0:
            ev_copy["amplified"] = True
        filtered_events.append(ev_copy)

    # Add V4 extra events (inspiration, feedback)
    filtered_events.extend(v4_extra)

    if filtered_events:
        xml += "  <active_events>\n"
        for ev in filtered_events:
            rel = "高度相关" if ev["relevance"] >= 0.8 else "相关" if ev["relevance"] >= 0.5 else "间接相关"
            amp_tag = " [认知放大]" if ev.get("amplified") else ""
            xml += f"    {ev['name']} (强度{ev['intensity']:.1f}, {rel}, {ev['ago_min']}分钟前){amp_tag}\n"
        xml += "  </active_events>\n"

    xml += "  <trigger_context>\n"
    xml += f"    冲动强度: {int(scenario['impulse'] * 100)}%\n"
    if scenario["suppressions"] > 0:
        xml += f"    已抑制: {scenario['suppressions']}次\n"
    if scenario["idle_min"] > 0:
        xml += f"    沉默时长: {scenario['idle_min']}分钟\n"

    # V4: memory pressure
    v4_pressure = scenario.get("v4_pressure", 0)
    if v4_pressure > 0:
        xml += f"    情绪积压: {v4_pressure}%\n"

    xml += "  </trigger_context>\n</internal_state>"

    return f"""{template}

{xml}

请以{CHARACTER['name']}的身份，基于以上内心状态，自然地主动发一条消息给用户。不要提及情绪数值或系统状态。"""


# === LLM Calls ===

def call_llm(system, prompt, api_key, base_url, model, temperature=0.8, max_tokens=500):
    """Call LLM API (OpenAI-compatible)"""
    for attempt in range(3):
        try:
            resp = requests.post(f"{base_url}/chat/completions", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }, headers={"Authorization": f"Bearer {api_key}"}, timeout=60)

            if resp.status_code == 429:
                wait = 15 * (attempt + 1)
                print(f"  Rate limited, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue

            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"  Error (attempt {attempt+1}): {e}", file=sys.stderr)
            if attempt < 2:
                time.sleep(5)
    return "[ERROR] Failed after 3 attempts"


# === Judge ===

JUDGE_SYSTEM = """你是角色扮演质量评审专家。你会看到同一个角色在相同情境下生成的两条主动消息（A 和 B），它们由不同的 prompt 格式驱动。

你的任务是对每个维度做 pairwise comparison，判断哪个更好。

4 个评估维度：
- emotional_naturalness（情感自然度）：消息的情感表达是否自然、不生硬、不模板化
- context_relevance（上下文相关性）：消息是否与当前情境（情绪状态、事件、沉默时长）高度相关
- character_consistency（角色一致性）：是否符合角色的性格和说话方式
- proactive_quality（主动性质量）：作为主动消息，是否有合理的动机、不突兀、让人想回复

重要规则：
- 你必须做出选择，不能说"都很好"
- 如果差异微小，也要指出具体的微小差异
- 用中文回答
- 严格输出 JSON"""


def build_judge_prompt(scenario, v2_response, v4_response):
    return f"""## 场景: {scenario['name']}
{scenario['description']}

角色: {CHARACTER['name']} — {CHARACTER['personality']}

### 消息 A (V2 结构化 prompt):
{v2_response}

### 消息 B (V4 行为动力学 prompt):
{v4_response}

请对以下 4 个维度做 pairwise comparison:
- emotional_naturalness（情感自然度）
- context_relevance（上下文相关性）
- character_consistency（角色一致性）
- proactive_quality（主动性质量）

输出 JSON:
{{
  "comparisons": [
    {{
      "dimension": "维度名",
      "winner": "A" | "B" | "tie",
      "margin": "large" | "small" | "negligible",
      "reason": "具体理由"
    }}
  ],
  "overall_winner": "A" | "B" | "tie",
  "overall_reason": "总体评价"
}}

严格输出 JSON，不要加 markdown 代码块。"""


def parse_judge_response(text):
    """Parse JSON from judge response, handling markdown fences"""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except:
                pass
        return {"error": "JSON parse failed", "raw": text[:500]}


# === HTML Report ===

def generate_html(results, model, judge_model):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    total_a, total_b, total_tie = 0, 0, 0
    for r in results:
        j = r.get("judge", {})
        for c in j.get("comparisons", []):
            w = c.get("winner", "tie")
            if w == "A": total_a += 1
            elif w == "B": total_b += 1
            else: total_tie += 1

    total = total_a + total_b + total_tie
    pct = lambda n: max(n / total * 100, 3) if total > 0 and n > 0 else 0

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Proactive V4 Behavioral Dynamics Comparison &mdash; {ts}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; line-height: 1.6; }}
.container {{ max-width: 1000px; margin: 0 auto; }}
h1 {{ font-size: 1.6rem; margin-bottom: 0.3rem; color: #fff; }}
h2 {{ font-size: 1.2rem; margin: 2rem 0 0.8rem; color: #ccc; border-bottom: 1px solid #333; padding-bottom: 0.4rem; }}
.meta {{ color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }}
.bar {{ display: flex; height: 36px; border-radius: 8px; overflow: hidden; margin: 1rem 0; }}
.bar div {{ display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.85rem; }}
.bar-a {{ background: #e67e22; }}
.bar-tie {{ background: #7f8c8d; }}
.bar-b {{ background: #2ecc71; }}
.stats {{ display: flex; gap: 2rem; margin: 1rem 0; }}
.stat {{ text-align: center; }}
.stat-num {{ font-size: 1.8rem; font-weight: bold; }}
.stat-label {{ font-size: 0.75rem; color: #888; }}
.stat-a .stat-num {{ color: #e67e22; }}
.stat-b .stat-num {{ color: #2ecc71; }}
.stat-tie .stat-num {{ color: #7f8c8d; }}
.scenario {{ background: #111; border-radius: 12px; padding: 1.5rem; margin: 1.5rem 0; }}
.scenario-title {{ font-size: 1.1rem; color: #fff; margin-bottom: 0.3rem; }}
.scenario-desc {{ color: #888; font-size: 0.85rem; margin-bottom: 1rem; }}
.responses {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }}
.response {{ background: #1a1a1a; border-radius: 8px; padding: 1rem; }}
.response-label {{ font-size: 0.8rem; font-weight: bold; margin-bottom: 0.5rem; }}
.label-a {{ color: #e67e22; }}
.label-b {{ color: #2ecc71; }}
.response-text {{ color: #ddd; font-size: 0.95rem; white-space: pre-wrap; }}
.comp {{ background: #1a1a1a; border-radius: 8px; padding: 0.8rem; margin: 0.4rem 0; display: flex; justify-content: space-between; align-items: center; }}
.comp-dim {{ color: #ccc; }}
.badge {{ padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: bold; }}
.badge-a {{ background: #e67e2233; color: #e67e22; }}
.badge-b {{ background: #2ecc7133; color: #2ecc71; }}
.badge-tie {{ background: #7f8c8d33; color: #7f8c8d; }}
.reason {{ color: #999; font-size: 0.85rem; margin-top: 0.3rem; }}
.overall {{ background: #1a1a2a; border-radius: 8px; padding: 1rem; margin-top: 1rem; color: #aaa; font-style: italic; }}
.prompt-toggle {{ color: #666; font-size: 0.8rem; cursor: pointer; margin-top: 0.5rem; }}
.prompt-toggle:hover {{ color: #aaa; }}
details {{ margin-top: 0.5rem; }}
summary {{ color: #666; font-size: 0.8rem; cursor: pointer; }}
summary:hover {{ color: #aaa; }}
pre {{ background: #0d0d0d; padding: 0.8rem; border-radius: 6px; font-size: 0.75rem; color: #888; overflow-x: auto; white-space: pre-wrap; margin-top: 0.5rem; }}
.v4-tag {{ display: inline-block; background: #9b59b633; color: #9b59b6; font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; margin-left: 0.5rem; }}
</style>
</head>
<body>
<div class="container">
<h1>Proactive V4 Behavioral Dynamics Comparison</h1>
<div class="meta">
  Model: {model} | Judge: {judge_model} | Character: {CHARACTER['name']} |
  Scenarios: {len(results)} | Generated: {ts}<br>
  V4 features: 情绪积压 / 灵感事件 / 自我反馈 / 认知过滤
</div>

<h2>Overall</h2>
<div class="bar">
  <div class="bar-a" style="width:{pct(total_a)}%">V2 {total_a}</div>
  <div class="bar-tie" style="width:{pct(total_tie)}%">Tie {total_tie}</div>
  <div class="bar-b" style="width:{pct(total_b)}%">V4 {total_b}</div>
</div>
<div class="stats">
  <div class="stat stat-a"><div class="stat-num">{total_a}</div><div class="stat-label">V2 Wins</div></div>
  <div class="stat stat-tie"><div class="stat-num">{total_tie}</div><div class="stat-label">Ties</div></div>
  <div class="stat stat-b"><div class="stat-num">{total_b}</div><div class="stat-label">V4 Wins</div></div>
</div>

<h2>Per-Scenario Results</h2>
"""

    for r in results:
        s = r["scenario"]
        j = r.get("judge", {})
        overall = j.get("overall_winner", "tie")
        badge_cls = "badge-a" if overall == "A" else "badge-b" if overall == "B" else "badge-tie"
        badge_txt = "V2" if overall == "A" else "V4" if overall == "B" else "Tie"

        # Build V4 feature tags for this scenario
        v4_tags = []
        if s.get("v4_pressure", 0) > 0:
            v4_tags.append(f'积压{s["v4_pressure"]}%')
        for ev in s.get("v4_extra_events", []):
            v4_tags.append(ev["name"])
        if s.get("v4_sensitivity", {}):
            for k, v in s["v4_sensitivity"].items():
                v4_tags.append(f'{k}x{v}')
        v4_tag_html = "".join(f'<span class="v4-tag">{t}</span>' for t in v4_tags)

        html += f"""<div class="scenario">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div class="scenario-title">{s['name']}{v4_tag_html}</div>
    <span class="badge {badge_cls}">{badge_txt}</span>
  </div>
  <div class="scenario-desc">{s['description']}</div>
  <div class="responses">
    <div class="response">
      <div class="response-label label-a">A: V2 (结构化)</div>
      <div class="response-text">{r.get('v2_response', '[error]')}</div>
    </div>
    <div class="response">
      <div class="response-label label-b">B: V4 (行为动力学)</div>
      <div class="response-text">{r.get('v4_response', '[error]')}</div>
    </div>
  </div>
"""
        for c in j.get("comparisons", []):
            w = c.get("winner", "tie")
            w_cls = "badge-a" if w == "A" else "badge-b" if w == "B" else "badge-tie"
            w_txt = "V2" if w == "A" else "V4" if w == "B" else "Tie"
            html += f"""  <div class="comp">
    <div>
      <div class="comp-dim">{c.get('dimension', '?')}</div>
      <div class="reason">{c.get('reason', '')}</div>
    </div>
    <span class="badge {w_cls}">{w_txt}</span>
  </div>
"""
        overall_reason = j.get("overall_reason", "")
        if overall_reason:
            html += f'  <div class="overall"><strong>Overall:</strong> {overall_reason}</div>\n'

        # Collapsible prompts
        v2p = r.get('v2_prompt', '').replace('<', '&lt;').replace('>', '&gt;')
        v4p = r.get('v4_prompt', '').replace('<', '&lt;').replace('>', '&gt;')
        html += f"""  <details><summary>View prompts</summary>
    <pre>{v2p}</pre>
    <pre>{v4p}</pre>
  </details>
</div>
"""

    html += "</div></body></html>"
    return html


# === Main ===

def main():
    parser = argparse.ArgumentParser(description="Proactive V4 Behavioral Dynamics Comparison")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--model", default="Qwen/Qwen3-VL-30B-A3B-Instruct")
    parser.add_argument("--judge-model", default="Qwen/Qwen3-VL-30B-A3B-Instruct")
    parser.add_argument("--base-url", default="https://api.siliconflow.cn/v1")
    parser.add_argument("--output", default="results/proactive-v4-behavioral.html")
    parser.add_argument("--runs", type=int, default=2, help="Runs per scenario for stability")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    results = []
    for scenario in SCENARIOS:
        for run_idx in range(args.runs):
            run_label = f"[{scenario['id']}] run {run_idx+1}/{args.runs}"
            print(f"\n{'='*50}", file=sys.stderr)
            print(f"Scenario: {scenario['name']} ({run_label})", file=sys.stderr)

            v2_prompt = build_v2_prompt(scenario)
            v4_prompt = build_v4_prompt(scenario)

            # Generate responses
            print(f"  Generating V2 response...", file=sys.stderr)
            v2_resp = call_llm(SYSTEM_PROMPT, v2_prompt, args.api_key, args.base_url, args.model)
            time.sleep(2)

            print(f"  Generating V4 response...", file=sys.stderr)
            v4_resp = call_llm(SYSTEM_PROMPT, v4_prompt, args.api_key, args.base_url, args.model)
            time.sleep(2)

            print(f"  V2: {v2_resp[:80]}...", file=sys.stderr)
            print(f"  V4: {v4_resp[:80]}...", file=sys.stderr)

            # Judge
            print(f"  Judging...", file=sys.stderr)
            judge_prompt = build_judge_prompt(scenario, v2_resp, v4_resp)
            judge_raw = call_llm(JUDGE_SYSTEM, judge_prompt, args.api_key, args.base_url,
                                 args.judge_model, temperature=0.3, max_tokens=2000)
            judge = parse_judge_response(judge_raw)
            time.sleep(2)

            overall = judge.get("overall_winner", "?")
            print(f"  Judge: {overall}", file=sys.stderr)

            results.append({
                "scenario": scenario,
                "run": run_idx,
                "v2_prompt": v2_prompt,
                "v4_prompt": v4_prompt,
                "v2_response": v2_resp,
                "v4_response": v4_resp,
                "judge": judge,
            })

    # Save raw JSON
    json_path = args.output.replace(".html", ".json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nRaw JSON: {json_path}", file=sys.stderr)

    # Generate HTML report
    html = generate_html(results, args.model, args.judge_model)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML report: {args.output}", file=sys.stderr)

    # Summary
    a_wins = sum(1 for r in results for c in r.get("judge", {}).get("comparisons", []) if c.get("winner") == "A")
    b_wins = sum(1 for r in results for c in r.get("judge", {}).get("comparisons", []) if c.get("winner") == "B")
    ties = sum(1 for r in results for c in r.get("judge", {}).get("comparisons", []) if c.get("winner") == "tie")
    print(f"\n{'='*50}", file=sys.stderr)
    print(f"TOTAL: V2={a_wins}  V4={b_wins}  Tie={ties}", file=sys.stderr)
    print(f"{'='*50}", file=sys.stderr)


if __name__ == "__main__":
    main()
