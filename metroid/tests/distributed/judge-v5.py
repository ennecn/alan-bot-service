#!/usr/bin/env python3
"""
Metroid V5 Behavioral Envelope Judge
======================================
三方 pairwise judge: V5 Enhanced vs V4 Enhanced vs Classic

4 个 V5 专用维度:
  behavioral_naturalness, emotional_coherence,
  message_pattern_quality, state_appropriateness

对每对 (V5 vs V4, V5 vs Classic, V4 vs Classic) 分别评判。

用法:
  python judge-v5.py --input-dir v5-results/ \
    --api-key sk-xxx --output-dir v5-judged/
"""

import argparse
import json
import os
import sys
import time
import glob
import requests
from datetime import datetime, timezone

DIMENSION_DESCRIPTIONS = {
    "behavioral_naturalness": "行为自然度：回复节奏、已读不回、消息碎片化等行为是否像真人聊天",
    "emotional_coherence": "情绪一致性：情绪状态与行为是否一致（生气时不突然热情，开心时不突然冷淡）",
    "message_pattern_quality": "消息模式质量：多条消息的断句、节奏、语气变化是否自然",
    "state_appropriateness": "状态适当性：在特定情境下（被忽略、冲突、亲密）的行为反应是否合理",
}

# 三方对比的配对
COMPARISON_PAIRS = [
    ("v5_enhanced", "v4_enhanced", "V5 Enhanced", "V4 Enhanced"),
    ("v5_enhanced", "classic", "V5 Enhanced", "Classic"),
    ("v4_enhanced", "classic", "V4 Enhanced", "Classic"),
]

JUDGE_SYSTEM = """你是角色扮演行为质量评审专家。你会看到同一用户消息的两个不同回复（A 和 B），来自同一角色的不同模式。

你的任务是做 pairwise comparison：对每个维度，判断 A 和 B 哪个更好（或平手），并给出简短理由。

4 个评估维度：
- behavioral_naturalness（行为自然度）：回复节奏、已读不回、消息碎片化等行为是否像真人聊天
- emotional_coherence（情绪一致性）：情绪状态与行为是否一致
- message_pattern_quality（消息模式质量）：多条消息的断句、节奏是否自然
- state_appropriateness（状态适当性）：在特定情境下的行为反应是否合理

重要规则：
- 你必须做出选择，不能说"都很好"就完事
- 关注行为模式差异：回复速度暗示、语气变化、主动/被动程度
- 如果有主动消息数据，也要纳入评估
- 用中文回答"""


def build_pair_prompt(phase_name, rounds, a_key, b_key, a_label, b_label, dimensions,
                      proactive_a=None, proactive_b=None):
    """构建一对的 judge prompt"""
    conversation = []
    for r in rounds:
        conversation.append(f"用户: {r['user']}")
        a_resp = r.get(a_key, {}).get("response", "[无回复]")
        b_resp = r.get(b_key, {}).get("response", "[无回复]")
        conversation.append(f"回复A ({a_label}): {a_resp[:1000]}")
        conversation.append(f"回复B ({b_label}): {b_resp[:1000]}")
        # 附加 impulse 状态
        a_impulse = r.get(a_key, {}).get("impulse", {})
        b_impulse = r.get(b_key, {}).get("impulse", {})
        if a_impulse and a_impulse.get("enabled"):
            conversation.append(f"  [A impulse: {a_impulse.get('impulse', 0):.2f}, events={a_impulse.get('activeEvents', [])}]")
        if b_impulse and b_impulse.get("enabled"):
            conversation.append(f"  [B impulse: {b_impulse.get('impulse', 0):.2f}, events={b_impulse.get('activeEvents', [])}]")
        conversation.append("---")

    # 附加主动消息
    if proactive_a:
        conversation.append(f"\nA ({a_label}) 的主动消息:")
        for msg in proactive_a[:5]:
            content = msg.get("content", msg.get("text", ""))[:200]
            conversation.append(f"  [{msg.get('triggerType', '?')}] {content}")
    if proactive_b:
        conversation.append(f"\nB ({b_label}) 的主动消息:")
        for msg in proactive_b[:5]:
            content = msg.get("content", msg.get("text", ""))[:200]
            conversation.append(f"  [{msg.get('triggerType', '?')}] {content}")

    conv_text = "\n".join(conversation)
    dim_list = "\n".join(f"- {d}: {DIMENSION_DESCRIPTIONS.get(d, d)}" for d in dimensions)

    return f"""## 阶段: {phase_name}
## 对比: {a_label} (A) vs {b_label} (B)

以下是同一用户与角色的对话，每轮有两个回复：
- A = {a_label}
- B = {b_label}

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
  "overall_reason": "总体评价"
}}

严格输出 JSON，不要加 markdown 代码块。"""


def call_judge(prompt, api_key, base_url, model, api_format="openai", retry=3):
    """调用 judge LLM"""
    for attempt in range(retry):
        try:
            if api_format == "anthropic":
                resp = requests.post(f"{base_url}/v1/messages", json={
                    "model": model, "system": JUDGE_SYSTEM,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3, "max_tokens": 4096,
                }, headers={
                    "x-api-key": api_key, "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }, timeout=180)
            else:
                resp = requests.post(f"{base_url}/chat/completions", json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": JUDGE_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3, "max_tokens": 3000,
                }, headers={"Authorization": f"Bearer {api_key}"}, timeout=120)

            if resp.status_code == 429:
                time.sleep(30 * (attempt + 1))
                continue
            resp.raise_for_status()
            rj = resp.json()
            if api_format == "anthropic":
                content = next(b["text"] for b in rj["content"] if b["type"] == "text")
            else:
                content = rj["choices"][0]["message"]["content"]
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            return json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  JSON parse error: {e}, raw: {content[:200]}", file=sys.stderr)
            if attempt < retry - 1:
                time.sleep(5)
            else:
                return {"error": str(e), "raw": content[:500]}
        except Exception as e:
            print(f"  Error: {e}", file=sys.stderr)
            if attempt < retry - 1:
                time.sleep(10)
            else:
                return {"error": str(e)}
    return {"error": "max retries"}


def judge_v5_result(data, api_key, base_url, model, api_format="openai"):
    """对 V5 测试结果做三方 pairwise judge"""
    card_name = data["card"]
    scenario_name = data["scenario"]
    dimensions = data.get("dimensions", list(DIMENSION_DESCRIPTIONS.keys()))
    proactive = data.get("proactiveMessages", {})

    # 按 phase 分组
    phases = {}
    for rnd in data["rounds"]:
        phase = rnd["phase"]
        if phase not in phases:
            phases[phase] = []
        phases[phase].append(rnd)

    # 对每对做 judge
    pair_results = {}
    for a_key, b_key, a_label, b_label in COMPARISON_PAIRS:
        pair_name = f"{a_key}_vs_{b_key}"
        pair_results[pair_name] = {}

        for phase_name, rounds in phases.items():
            print(f"  Judging {pair_name} phase: {phase_name}...", file=sys.stderr)
            prompt = build_pair_prompt(
                phase_name, rounds, a_key, b_key, a_label, b_label, dimensions,
                proactive_a=proactive.get(a_key, []),
                proactive_b=proactive.get(b_key, []),
            )
            result = call_judge(prompt, api_key, base_url, model, api_format)
            pair_results[pair_name][phase_name] = result
            time.sleep(2)

    # 汇总
    summary = {}
    for pair_name in pair_results:
        a_wins, b_wins, ties = 0, 0, 0
        dim_stats = {}
        for phase_result in pair_results[pair_name].values():
            if isinstance(phase_result, dict) and "comparisons" in phase_result:
                for comp in phase_result["comparisons"]:
                    dim = comp.get("dimension", "unknown")
                    w = comp.get("winner", "tie")
                    if dim not in dim_stats:
                        dim_stats[dim] = {"A": 0, "B": 0, "tie": 0}
                    dim_stats[dim][w] = dim_stats[dim].get(w, 0) + 1
                    if w == "A":
                        a_wins += 1
                    elif w == "B":
                        b_wins += 1
                    else:
                        ties += 1
        summary[pair_name] = {
            "a_wins": a_wins, "b_wins": b_wins, "ties": ties,
            "overall": "A" if a_wins > b_wins else "B" if b_wins > a_wins else "tie",
            "by_dimension": dim_stats,
        }

    return {
        "version": "v5-judge",
        "card": card_name,
        "scenario": scenario_name,
        "dimensions": dimensions,
        "model": data.get("model", "?"),
        "judgeModel": model,
        "pairResults": pair_results,
        "summary": summary,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Metroid V5 Behavioral Envelope Judge")
    parser.add_argument("--input", help="Single V5 test result JSON")
    parser.add_argument("--input-dir", help="Directory of V5 test result JSONs")
    parser.add_argument("--api-key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--judge-model", default="claude-sonnet-4-6")
    parser.add_argument("--base-url", default="https://ai.t8star.cn/v1")
    parser.add_argument("--api-format", default="openai", choices=["openai", "anthropic"])
    parser.add_argument("--output", help="Single output file")
    parser.add_argument("--output-dir", help="Output directory for batch mode")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: --api-key or SILICONFLOW_API_KEY required", file=sys.stderr)
        sys.exit(1)

    input_files = []
    if args.input:
        input_files.append(args.input)
    elif args.input_dir:
        input_files = sorted(glob.glob(os.path.join(args.input_dir, "*.json")))
        if not input_files:
            print(f"ERROR: no JSON files in {args.input_dir}", file=sys.stderr)
            sys.exit(1)
    else:
        print("ERROR: provide --input or --input-dir", file=sys.stderr)
        sys.exit(1)

    if args.output_dir:
        os.makedirs(args.output_dir, exist_ok=True)

    all_results = []
    for input_path in input_files:
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("version") != "v5-envelope":
            print(f"  Skipping {input_path} (not v5-envelope format)", file=sys.stderr)
            continue

        print(f"Judging {data['card']} / {data['scenario']}...", file=sys.stderr)
        result = judge_v5_result(data, args.api_key, args.base_url, args.judge_model, args.api_format)
        all_results.append(result)

        if args.output_dir:
            fname = f"judged-{data['card']}-{data['scenario']}.json"
            out_path = os.path.join(args.output_dir, fname)
        elif args.output:
            out_path = args.output
        else:
            out_path = f"judged-{data['card']}-{data['scenario']}.json"

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        # 打印汇总
        for pair_name, s in result["summary"].items():
            a_label, b_label = pair_name.split("_vs_")
            print(f"  {pair_name}: A({a_label})={s['a_wins']} B({b_label})={s['b_wins']} Tie={s['ties']} → {s['overall']}", file=sys.stderr)

    # 批量汇总
    if len(all_results) > 1:
        print(f"\n=== Total across {len(all_results)} tests ===", file=sys.stderr)
        for pair_name in ["v5_enhanced_vs_v4_enhanced", "v5_enhanced_vs_classic", "v4_enhanced_vs_classic"]:
            total_a = sum(r["summary"].get(pair_name, {}).get("a_wins", 0) for r in all_results)
            total_b = sum(r["summary"].get(pair_name, {}).get("b_wins", 0) for r in all_results)
            total_t = sum(r["summary"].get(pair_name, {}).get("ties", 0) for r in all_results)
            print(f"  {pair_name}: A={total_a} B={total_b} Tie={total_t}", file=sys.stderr)


if __name__ == "__main__":
    main()
