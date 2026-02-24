#!/usr/bin/env python3
"""
Metroid Pairwise Judge v3
==========================
读取 bot 返回的配对对话数据，用 LLM 做 pairwise comparison。
不打绝对分，只问"哪个更好，为什么"。

6 个 UX 维度:
  immersion, character_consistency, emotional_resonance,
  memory_coherence, growth_authenticity, engagement_quality

用法 (单文件):
  python judge_pairwise.py --input result.json \
    --api-key sk-xxx --output judged.json

用法 (批量):
  python judge_pairwise.py --input-dir results/ \
    --api-key sk-xxx --output-dir judged/

输出: 带 pairwise 判定的 JSON
"""

import argparse
import json
import os
import sys
import time
import glob
import requests
from datetime import datetime, timezone

# 6 个 UX 维度的中文描述，用于 judge prompt
DIMENSION_DESCRIPTIONS = {
    "immersion": '沉浸感：用户是否感觉在和"真人"对话，而非AI或模板回复',
    "character_consistency": "角色一致性：是否始终保持人设，不OOC，语气/性格/知识边界一致",
    "emotional_resonance": "情感共鸣：角色的情感反应是否自然、有温度、能引起用户共情",
    "memory_coherence": "记忆连贯：是否记得之前的对话细节，引用是否准确",
    "growth_authenticity": "成长真实感：角色关系是否有自然发展，而非机械重复",
    "engagement_quality": "互动质量：回复是否有趣、有深度、让人想继续聊下去",
}

DEFAULT_DIMENSIONS = list(DIMENSION_DESCRIPTIONS.keys())

JUDGE_SYSTEM = """你是角色扮演质量评审专家。你会看到同一个用户消息的两个不同回复（A 和 B），来自同一角色的两种模式。

你的任务是做 pairwise comparison：对每个维度，判断 A 和 B 哪个更好（或平手），并给出简短理由。

6 个评估维度：
- immersion（沉浸感）：用户是否感觉在和"真人"对话
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


def build_phase_prompt(phase_name, pairs, dimensions):
    """构建一个 phase 的 judge prompt"""
    conversation = []
    for p in pairs:
        conversation.append(f"用户: {p['user']}")
        conversation.append(f"回复A (classic): {p['classic']['response'][:1000]}")
        conversation.append(f"回复B (enhanced): {p['enhanced']['response'][:1000]}")
        # 附加 metadata
        if p['enhanced'].get('emotion'):
            e = p['enhanced']['emotion']
            conversation.append(f"  [B的情绪状态: pleasure={e.get('pleasure',0):.2f}, arousal={e.get('arousal',0):.2f}, dominance={e.get('dominance',0):.2f}]")
        if p['enhanced'].get('growthChanges', 0) > 0:
            conversation.append(f"  [B的成长变化数: {p['enhanced']['growthChanges']}]")
        conversation.append("---")

    conv_text = "\n".join(conversation)

    dim_list = "\n".join(f"- {d}: {DIMENSION_DESCRIPTIONS.get(d, d)}" for d in dimensions)

    prompt = f"""## 阶段: {phase_name}

以下是同一用户与角色的对话，每轮有两个回复：
- A = classic 模式（基础角色扮演）
- B = enhanced 模式（带情绪引擎+成长系统+记忆增强）

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

    return prompt


def call_judge(prompt, api_key, base_url, model, retry=3, api_format="openai"):
    """调用 judge LLM (支持 openai 和 anthropic 格式)"""
    for attempt in range(retry):
        try:
            if api_format == "anthropic":
                resp = requests.post(f"{base_url}/v1/messages", json={
                    "model": model,
                    "system": JUDGE_SYSTEM,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 4096,
                }, headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }, timeout=180)
            else:
                resp = requests.post(f"{base_url}/chat/completions", json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": JUDGE_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 3000,
                }, headers={
                    "Authorization": f"Bearer {api_key}",
                }, timeout=120)

            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                print(f"  Rate limited, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue

            resp.raise_for_status()
            rj = resp.json()
            if api_format == "anthropic":
                content = next(b["text"] for b in rj["content"] if b["type"] == "text")
            else:
                content = rj["choices"][0]["message"]["content"]

            # 尝试解析 JSON
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


def judge_result(data, api_key, base_url, model, api_format="openai"):
    """对整个测试结果做 pairwise judge"""
    scenario_name = data["scenario"]
    card_name = data["card"]

    # 优先使用结果文件中携带的 dimensions
    dimensions = data.get("dimensions", [])
    if not dimensions:
        # fallback: 从 scenario 文件加载
        scenario_file = os.path.join(
            os.path.dirname(__file__), "scenarios", f"{scenario_name}.json"
        )
        if os.path.exists(scenario_file):
            with open(scenario_file, "r", encoding="utf-8") as f:
                scenario = json.load(f)
            dimensions = scenario.get("dimensions", DEFAULT_DIMENSIONS)
        else:
            dimensions = DEFAULT_DIMENSIONS

    # 按 phase 分组
    phases = {}
    for pair in data["pairs"]:
        phase = pair["phase"]
        if phase not in phases:
            phases[phase] = []
        phases[phase].append(pair)

    # 逐 phase judge
    phase_results = {}
    for phase_name, pairs in phases.items():
        print(f"  Judging {card_name}/{scenario_name} phase: {phase_name} ({len(pairs)} rounds)...", file=sys.stderr)
        prompt = build_phase_prompt(phase_name, pairs, dimensions)
        result = call_judge(prompt, api_key, base_url, model, api_format=api_format)
        phase_results[phase_name] = result
        time.sleep(2)  # 避免限流

    # 汇总 — 按维度统计
    dim_stats = {}
    a_wins = 0
    b_wins = 0
    ties = 0
    for phase_result in phase_results.values():
        if isinstance(phase_result, dict) and "comparisons" in phase_result:
            for comp in phase_result["comparisons"]:
                dim = comp.get("dimension", "unknown")
                w = comp.get("winner", "tie")
                margin = comp.get("margin", "negligible")

                if dim not in dim_stats:
                    dim_stats[dim] = {"A": 0, "B": 0, "tie": 0}
                dim_stats[dim][w] = dim_stats[dim].get(w, 0) + 1

                if w == "A":
                    a_wins += 1
                elif w == "B":
                    b_wins += 1
                else:
                    ties += 1

    summary = {
        "classic_wins": a_wins,
        "enhanced_wins": b_wins,
        "ties": ties,
        "overall": "classic" if a_wins > b_wins else "enhanced" if b_wins > a_wins else "tie",
        "by_dimension": dim_stats,
    }

    return {
        "version": 3,
        "card": card_name,
        "scenario": scenario_name,
        "dimensions": dimensions,
        "model": data.get("model", "?"),
        "judgeModel": model,
        "phaseResults": phase_results,
        "summary": summary,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Metroid Pairwise Judge v3")
    parser.add_argument("--input", help="Single bot output JSON file")
    parser.add_argument("--input-dir", help="Directory of bot output JSON files")
    parser.add_argument("--api-key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--judge-model", default="claude-sonnet-4-6")
    parser.add_argument("--base-url", default="https://ai.t8star.cn/v1")
    parser.add_argument("--api-format", default="openai", choices=["openai", "anthropic"],
                        help="API format: openai (default) or anthropic (for DashScope etc)")
    parser.add_argument("--output", help="Single output file")
    parser.add_argument("--output-dir", help="Output directory for batch mode")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: --api-key or SILICONFLOW_API_KEY required", file=sys.stderr)
        sys.exit(1)

    # 收集输入文件
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

        print(f"Judging {data['card']} / {data['scenario']}...", file=sys.stderr)
        result = judge_result(data, args.api_key, args.base_url, args.judge_model, args.api_format)
        all_results.append(result)

        # 写入单个结果
        if args.output_dir:
            fname = f"judged-{data['card']}-{data['scenario']}.json"
            out_path = os.path.join(args.output_dir, fname)
        elif args.output:
            out_path = args.output
        else:
            out_path = f"judged-{data['card']}-{data['scenario']}.json"

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        s = result["summary"]
        print(f"  → Classic={s['classic_wins']} Enhanced={s['enhanced_wins']} Tie={s['ties']} ({s['overall']})", file=sys.stderr)

    # 批量汇总
    if len(all_results) > 1:
        total_c = sum(r["summary"]["classic_wins"] for r in all_results)
        total_e = sum(r["summary"]["enhanced_wins"] for r in all_results)
        total_t = sum(r["summary"]["ties"] for r in all_results)
        print(f"\nTotal: Classic={total_c} Enhanced={total_e} Tie={total_t}", file=sys.stderr)


if __name__ == "__main__":
    main()
