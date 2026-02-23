#!/usr/bin/env python3
"""
Metroid HTML Report Generator v3
=================================
将 pairwise judge 结果转为人类可读的 HTML 报告。
支持多卡多场景的综合分析。

用法:
  python generate_report.py --input judged1.json judged2.json ... --output report.html
  python generate_report.py --input-dir judged/ --output report.html
"""

import argparse
import json
import sys
import os
import glob
from datetime import datetime
from collections import defaultdict


def pct(n, total):
    return max(n / total * 100, 3) if total > 0 and n > 0 else 0


def winner_badge(overall):
    if overall == "classic":
        return "badge-classic", "Classic"
    elif overall == "enhanced":
        return "badge-enhanced", "Enhanced"
    return "badge-tie", "Tie"


def build_analysis(judged_results):
    """构建多维度分析数据"""
    # 按卡分析
    by_card = defaultdict(lambda: {"classic": 0, "enhanced": 0, "tie": 0, "tests": []})
    # 按场景分析
    by_scenario = defaultdict(lambda: {"classic": 0, "enhanced": 0, "tie": 0, "tests": []})
    # 按维度分析
    by_dimension = defaultdict(lambda: {"A": 0, "B": 0, "tie": 0})

    for r in judged_results:
        card = r.get("card", "?")
        scenario = r.get("scenario", "?")
        s = r.get("summary", {})

        by_card[card]["classic"] += s.get("classic_wins", 0)
        by_card[card]["enhanced"] += s.get("enhanced_wins", 0)
        by_card[card]["tie"] += s.get("ties", 0)
        by_card[card]["tests"].append(r)

        by_scenario[scenario]["classic"] += s.get("classic_wins", 0)
        by_scenario[scenario]["enhanced"] += s.get("enhanced_wins", 0)
        by_scenario[scenario]["tie"] += s.get("ties", 0)
        by_scenario[scenario]["tests"].append(r)

        # 按维度汇总
        dim_stats = s.get("by_dimension", {})
        for dim, counts in dim_stats.items():
            by_dimension[dim]["A"] += counts.get("A", 0)
            by_dimension[dim]["B"] += counts.get("B", 0)
            by_dimension[dim]["tie"] += counts.get("tie", 0)

    return by_card, by_scenario, by_dimension


def generate_html(judged_results):
    """生成 HTML 报告"""
    if not isinstance(judged_results, list):
        judged_results = [judged_results]

    title = f"Metroid UX Test Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    # 汇总统计
    total_classic = sum(r["summary"]["classic_wins"] for r in judged_results)
    total_enhanced = sum(r["summary"]["enhanced_wins"] for r in judged_results)
    total_ties = sum(r["summary"]["ties"] for r in judged_results)
    total = total_classic + total_enhanced + total_ties

    by_card, by_scenario, by_dimension = build_analysis(judged_results)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; line-height: 1.6; }}
.container {{ max-width: 1200px; margin: 0 auto; }}
h1 {{ font-size: 1.8rem; margin-bottom: 0.5rem; color: #fff; }}
h2 {{ font-size: 1.3rem; margin: 2rem 0 1rem; color: #ccc; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }}
h3 {{ font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #aaa; }}
.meta {{ color: #888; font-size: 0.9rem; margin-bottom: 2rem; }}
.summary-bar {{ display: flex; height: 40px; border-radius: 8px; overflow: hidden; margin: 1rem 0; }}
.bar-classic {{ background: #e74c3c; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.9rem; }}
.bar-tie {{ background: #95a5a6; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.9rem; }}
.bar-enhanced {{ background: #2ecc71; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.9rem; }}
.summary-stats {{ display: flex; gap: 2rem; margin: 1rem 0; flex-wrap: wrap; }}
.stat {{ text-align: center; min-width: 80px; }}
.stat-num {{ font-size: 2rem; font-weight: bold; }}
.stat-label {{ font-size: 0.8rem; color: #888; }}
.stat-classic .stat-num {{ color: #e74c3c; }}
.stat-enhanced .stat-num {{ color: #2ecc71; }}
.stat-tie .stat-num {{ color: #95a5a6; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin: 1rem 0; }}
.card {{ background: #1a1a1a; border-radius: 8px; padding: 1.2rem; }}
.card-title {{ font-size: 1rem; color: #fff; margin-bottom: 0.8rem; display: flex; justify-content: space-between; align-items: center; }}
.mini-bar {{ display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }}
.mini-bar div {{ display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: white; font-weight: bold; }}
.comparison {{ background: #1a1a1a; border-radius: 8px; padding: 1rem; margin: 0.5rem 0; border-left: 4px solid #333; }}
.comparison.winner-A {{ border-left-color: #e74c3c; }}
.comparison.winner-B {{ border-left-color: #2ecc71; }}
.comparison.winner-tie {{ border-left-color: #95a5a6; }}
.comp-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }}
.comp-dim {{ font-weight: bold; color: #fff; }}
.comp-winner {{ padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }}
.comp-winner.A {{ background: #e74c3c33; color: #e74c3c; }}
.comp-winner.B {{ background: #2ecc7133; color: #2ecc71; }}
.comp-winner.tie {{ background: #95a5a633; color: #95a5a6; }}
.comp-margin {{ font-size: 0.75rem; color: #666; margin-left: 0.5rem; }}
.comp-reason {{ color: #aaa; font-size: 0.9rem; }}
.phase {{ background: #111; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }}
.phase-name {{ font-size: 1.1rem; color: #fff; margin-bottom: 0.5rem; }}
.notable {{ background: #1a1a2a; border-radius: 8px; padding: 1rem; margin: 0.5rem 0; }}
.notable li {{ margin: 0.3rem 0; color: #aaa; }}
.scenario-card {{ background: #111; border-radius: 12px; padding: 1.5rem; margin: 1.5rem 0; }}
.scenario-header {{ display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }}
.scenario-title {{ font-size: 1.2rem; color: #fff; }}
.badge {{ padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: bold; }}
.badge-classic {{ background: #e74c3c33; color: #e74c3c; }}
.badge-enhanced {{ background: #2ecc7133; color: #2ecc71; }}
.badge-tie {{ background: #95a5a633; color: #95a5a6; }}
.overall-reason {{ background: #1a1a1a; border-radius: 8px; padding: 1rem; margin-top: 1rem; color: #aaa; font-style: italic; }}
.dim-table {{ width: 100%; border-collapse: collapse; margin: 1rem 0; }}
.dim-table th, .dim-table td {{ padding: 0.6rem 1rem; text-align: left; border-bottom: 1px solid #222; }}
.dim-table th {{ color: #888; font-size: 0.85rem; font-weight: normal; }}
.dim-table td {{ color: #ccc; }}
.dim-winner {{ font-weight: bold; }}
.dim-winner.classic {{ color: #e74c3c; }}
.dim-winner.enhanced {{ color: #2ecc71; }}
.dim-winner.tie {{ color: #95a5a6; }}
details {{ margin: 0.5rem 0; }}
summary {{ cursor: pointer; color: #888; font-size: 0.9rem; }}
summary:hover {{ color: #ccc; }}
.test-count {{ color: #666; font-size: 0.85rem; }}
</style>
</head>
<body>
<div class="container">
<h1>{title}</h1>
<div class="meta">
  Tests: {len(judged_results)} | Cards: {len(by_card)} | Scenarios: {len(by_scenario)} |
  Judge: {judged_results[0].get('judgeModel', '?')} | Generated: {datetime.now().isoformat()}
</div>
"""

    # === Overall Summary ===
    html += '<h2>Overall Summary</h2>\n<div class="summary-bar">\n'
    if total > 0:
        html += f'  <div class="bar-classic" style="width:{pct(total_classic, total)}%">Classic {total_classic}</div>\n'
        html += f'  <div class="bar-tie" style="width:{pct(total_ties, total)}%">Tie {total_ties}</div>\n'
        html += f'  <div class="bar-enhanced" style="width:{pct(total_enhanced, total)}%">Enhanced {total_enhanced}</div>\n'
    html += '</div>\n<div class="summary-stats">\n'
    html += f'  <div class="stat stat-classic"><div class="stat-num">{total_classic}</div><div class="stat-label">Classic Wins</div></div>\n'
    html += f'  <div class="stat stat-tie"><div class="stat-num">{total_ties}</div><div class="stat-label">Ties</div></div>\n'
    html += f'  <div class="stat stat-enhanced"><div class="stat-num">{total_enhanced}</div><div class="stat-label">Enhanced Wins</div></div>\n'
    html += '</div>\n'

    # === Per-Dimension Analysis ===
    if by_dimension:
        html += '<h2>Per-Dimension Analysis</h2>\n'
        html += '<table class="dim-table"><tr><th>Dimension</th><th>Classic</th><th>Enhanced</th><th>Tie</th><th>Winner</th></tr>\n'
        for dim in sorted(by_dimension.keys()):
            counts = by_dimension[dim]
            a, b, t = counts["A"], counts["B"], counts["tie"]
            if a > b:
                w_class, w_text = "classic", "Classic"
            elif b > a:
                w_class, w_text = "enhanced", "Enhanced"
            else:
                w_class, w_text = "tie", "Tie"
            html += f'<tr><td>{dim}</td><td>{a}</td><td>{b}</td><td>{t}</td>'
            html += f'<td class="dim-winner {w_class}">{w_text}</td></tr>\n'
        html += '</table>\n'

    # === Per-Card Analysis ===
    html += '<h2>Per-Card Analysis</h2>\n<div class="grid">\n'
    for card_name, data in sorted(by_card.items()):
        c, e, t = data["classic"], data["enhanced"], data["tie"]
        card_total = c + e + t
        badge_cls, badge_txt = winner_badge("classic" if c > e else "enhanced" if e > c else "tie")
        html += f'<div class="card"><div class="card-title"><span>{card_name}</span>'
        html += f'<span class="badge {badge_cls}">{badge_txt}</span></div>\n'
        html += f'<div class="test-count">{len(data["tests"])} tests, {card_total} comparisons</div>\n'
        html += '<div class="mini-bar">\n'
        if card_total > 0:
            html += f'  <div class="bar-classic" style="width:{pct(c, card_total)}%">{c}</div>\n'
            html += f'  <div class="bar-tie" style="width:{pct(t, card_total)}%">{t}</div>\n'
            html += f'  <div class="bar-enhanced" style="width:{pct(e, card_total)}%">{e}</div>\n'
        html += '</div></div>\n'
    html += '</div>\n'

    # === Per-Scenario Analysis ===
    html += '<h2>Per-Scenario Analysis</h2>\n<div class="grid">\n'
    for scn_name, data in sorted(by_scenario.items()):
        c, e, t = data["classic"], data["enhanced"], data["tie"]
        scn_total = c + e + t
        badge_cls, badge_txt = winner_badge("classic" if c > e else "enhanced" if e > c else "tie")
        html += f'<div class="card"><div class="card-title"><span>{scn_name}</span>'
        html += f'<span class="badge {badge_cls}">{badge_txt}</span></div>\n'
        html += f'<div class="test-count">{len(data["tests"])} tests, {scn_total} comparisons</div>\n'
        html += '<div class="mini-bar">\n'
        if scn_total > 0:
            html += f'  <div class="bar-classic" style="width:{pct(c, scn_total)}%">{c}</div>\n'
            html += f'  <div class="bar-tie" style="width:{pct(t, scn_total)}%">{t}</div>\n'
            html += f'  <div class="bar-enhanced" style="width:{pct(e, scn_total)}%">{e}</div>\n'
        html += '</div></div>\n'
    html += '</div>\n'

    # === Detailed Results ===
    html += '<h2>Detailed Results</h2>\n'
    for result in judged_results:
        card = result.get("card", "?")
        scenario = result.get("scenario", "?")
        summary = result.get("summary", {})
        overall = summary.get("overall", "tie")
        badge_cls, badge_txt = winner_badge(overall)

        html += f'<div class="scenario-card">\n'
        html += f'  <div class="scenario-header">\n'
        html += f'    <div class="scenario-title">{card} / {scenario}</div>\n'
        html += f'    <span class="badge {badge_cls}">{badge_txt}</span>\n'
        html += f'  </div>\n'

        phase_results = result.get("phaseResults", {})
        for phase_name, phase_data in phase_results.items():
            if not isinstance(phase_data, dict) or "comparisons" not in phase_data:
                html += f'  <div class="phase"><div class="phase-name">{phase_name}</div>'
                html += f'<p style="color:#666">Judge error: {json.dumps(phase_data, ensure_ascii=False)[:200]}</p></div>\n'
                continue

            html += f'  <details><summary>Phase: {phase_name} ({len(phase_data.get("comparisons",[]))} dimensions)</summary>\n'
            html += f'  <div class="phase">\n'

            for comp in phase_data.get("comparisons", []):
                dim = comp.get("dimension", "?")
                w = comp.get("winner", "tie")
                margin = comp.get("margin", "")
                reason = comp.get("reason", "")
                w_class = "A" if w == "A" else "B" if w == "B" else "tie"
                w_label = "Classic" if w == "A" else "Enhanced" if w == "B" else "Tie"

                html += f'    <div class="comparison winner-{w_class}">\n'
                html += f'      <div class="comp-header">\n'
                html += f'        <span class="comp-dim">{dim}</span>\n'
                html += f'        <span><span class="comp-winner {w_class}">{w_label}</span>'
                html += f'<span class="comp-margin">{margin}</span></span>\n'
                html += f'      </div>\n'
                html += f'      <div class="comp-reason">{reason}</div>\n'
                html += f'    </div>\n'

            notables = phase_data.get("notable_differences", [])
            if notables:
                html += '    <div class="notable"><strong>Notable:</strong><ul>\n'
                for n in notables:
                    html += f"      <li>{n}</li>\n"
                html += "    </ul></div>\n"

            phase_overall = phase_data.get("overall_winner", "")
            phase_reason = phase_data.get("overall_reason", "")
            if phase_reason:
                html += f'    <div class="overall-reason"><strong>Phase verdict ({phase_overall}):</strong> {phase_reason}</div>\n'

            html += "  </div>\n  </details>\n"

        html += "</div>\n"

    html += """
</div>
</body>
</html>"""

    return html


def main():
    parser = argparse.ArgumentParser(description="Metroid HTML Report Generator v3")
    parser.add_argument("--input", nargs="*", help="Judged JSON file(s)")
    parser.add_argument("--input-dir", help="Directory of judged JSON files")
    parser.add_argument("--output", default="report.html")
    args = parser.parse_args()

    results = []
    if args.input:
        for path in args.input:
            with open(path, "r", encoding="utf-8") as f:
                results.append(json.load(f))
    elif args.input_dir:
        for path in sorted(glob.glob(os.path.join(args.input_dir, "*.json"))):
            with open(path, "r", encoding="utf-8") as f:
                results.append(json.load(f))
    else:
        print("ERROR: provide --input or --input-dir", file=sys.stderr)
        sys.exit(1)

    if not results:
        print("ERROR: no judged results found", file=sys.stderr)
        sys.exit(1)

    html = generate_html(results)

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Report generated: {args.output} ({len(results)} tests)", file=sys.stderr)


if __name__ == "__main__":
    main()
