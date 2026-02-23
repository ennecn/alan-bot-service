#!/usr/bin/env python3
"""
Metroid Distributed Test Runner v3
===================================
Bot 执行此脚本，不做 judge。只采集对话数据。

用法 (单任务，向后兼容):
  python run_test.py --server http://127.0.0.1:8100 \
    --card steinsgate \
    --scenario scenarios/emotion-probe.json \
    --api-key sk-xxx \
    --output result.json

用法 (多任务):
  python run_test.py --server http://127.0.0.1:8100 \
    --tasks steinsgate:emotional-arc frieren:silent-depth \
    --api-key sk-xxx \
    --output-dir ~/nas/metroid-tests/results/

输出: 配对的 classic/enhanced 对话 JSON（不含评分）
"""

import argparse
import json
import os
import sys
import time
import requests
from datetime import datetime, timezone


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", file=sys.stderr)


def create_agent(server, card, mode, api_key, model, base_url):
    """创建 agent 并注入 LLM 配置"""
    resp = requests.post(f"{server}/agents", json={
        "name": f"test-{card}-{mode}",
        "card": card,
        "mode": mode,
    }, timeout=30)
    resp.raise_for_status()
    agent = resp.json()["agent"]
    agent_id = agent["id"]

    # 注入 LLM 配置（全局生效，避免服务器 placeholder key 问题）
    requests.post(f"{server}/agents/{agent_id}/config", json={
        "openaiApiKey": api_key,
        "openaiModel": model,
        "openaiBaseUrl": base_url,
    }, timeout=10)

    log(f"Created agent {agent_id} ({card}/{mode})")
    return agent_id


def chat(server, agent_id, message, retry=3):
    """发送消息并返回完整响应（含 metadata）"""
    for attempt in range(retry):
        try:
            resp = requests.post(f"{server}/agents/{agent_id}/chat", json={
                "content": message,
                "userId": "test-user",
                "userName": "测试员",
            }, timeout=120)
            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                log(f"Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout:
            log(f"Timeout on attempt {attempt+1}, retrying...")
            time.sleep(5)
        except Exception as e:
            log(f"Error on attempt {attempt+1}: {e}")
            if attempt < retry - 1:
                time.sleep(10)
            else:
                return {"response": f"[ERROR] {e}", "error": str(e)}
    return {"response": "[ERROR] max retries", "error": "max retries"}


def run_paired_test(server, card, scenario, api_key, model, base_url):
    """对同一张卡同时跑 classic 和 enhanced，发送相同消息"""
    log(f"Starting paired test: {card} / {scenario['name']}")

    classic_id = create_agent(server, card, "classic", api_key, model, base_url)
    enhanced_id = create_agent(server, card, "enhanced", api_key, model, base_url)

    pairs = []
    total_start = time.time()

    for phase in scenario["phases"]:
        phase_name = phase["name"]
        messages = phase["messages"]
        log(f"Phase: {phase_name} ({len(messages)} messages)")

        for i, user_msg in enumerate(messages):
            round_start = time.time()

            # 发送相同消息给两个 agent
            classic_resp = chat(server, classic_id, user_msg)
            enhanced_resp = chat(server, enhanced_id, user_msg)

            round_ms = int((time.time() - round_start) * 1000)

            pair = {
                "phase": phase_name,
                "round": i,
                "user": user_msg,
                "classic": {
                    "response": classic_resp.get("response", ""),
                    "emotion": classic_resp.get("emotion"),
                    "growthChanges": classic_resp.get("growthChanges", 0),
                    "timing": classic_resp.get("timing"),
                    "voiceHint": classic_resp.get("voiceHint"),
                    "error": classic_resp.get("error"),
                },
                "enhanced": {
                    "response": enhanced_resp.get("response", ""),
                    "emotion": enhanced_resp.get("emotion"),
                    "growthChanges": enhanced_resp.get("growthChanges", 0),
                    "timing": enhanced_resp.get("timing"),
                    "voiceHint": enhanced_resp.get("voiceHint"),
                    "error": enhanced_resp.get("error"),
                },
                "roundMs": round_ms,
            }
            pairs.append(pair)
            log(f"  [{phase_name}][{i}] done ({round_ms}ms)")

            # 短暂间隔避免限流
            time.sleep(1)

    total_ms = int((time.time() - total_start) * 1000)

    result = {
        "version": 3,
        "card": card,
        "scenario": scenario["name"],
        "classicAgentId": classic_id,
        "enhancedAgentId": enhanced_id,
        "model": model,
        "baseUrl": base_url,
        "dimensions": scenario.get("dimensions", []),
        "pairs": pairs,
        "totalRounds": len(pairs),
        "totalMs": total_ms,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return result


def resolve_scenario_path(scenario_ref, script_dir):
    """解析 scenario 路径：支持文件路径或 scenarios/ 下的名称"""
    if os.path.isfile(scenario_ref):
        return scenario_ref
    # 尝试 scenarios/ 目录
    candidate = os.path.join(script_dir, "scenarios", f"{scenario_ref}.json")
    if os.path.isfile(candidate):
        return candidate
    # 尝试不带 .json
    candidate2 = os.path.join(script_dir, "scenarios", scenario_ref)
    if os.path.isfile(candidate2):
        return candidate2
    return scenario_ref  # 原样返回，让后续报错


def main():
    parser = argparse.ArgumentParser(description="Metroid Distributed Test Runner v3")
    parser.add_argument("--server", default="http://127.0.0.1:8100")
    # 单任务模式（向后兼容）
    parser.add_argument("--card", help="Card name (single task mode)")
    parser.add_argument("--scenario", help="Scenario JSON path (single task mode)")
    parser.add_argument("--output", help="Output JSON path (single task mode)")
    # 多任务模式
    parser.add_argument("--tasks", nargs="+", help="card:scenario pairs (e.g. steinsgate:emotional-arc)")
    parser.add_argument("--output-dir", help="Output directory for multi-task mode")
    # 共享参数
    parser.add_argument("--api-key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--model", default="Qwen/Qwen3-Next-80B-A3B-Instruct")
    parser.add_argument("--base-url", default="https://api.siliconflow.cn/v1")
    args = parser.parse_args()

    if not args.api_key:
        log("ERROR: --api-key or SILICONFLOW_API_KEY required")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))

    # 构建任务列表
    tasks = []
    if args.tasks:
        for task_spec in args.tasks:
            parts = task_spec.split(":", 1)
            if len(parts) != 2:
                log(f"ERROR: invalid task spec '{task_spec}', expected card:scenario")
                sys.exit(1)
            card, scenario_name = parts
            scenario_path = resolve_scenario_path(scenario_name, script_dir)
            tasks.append((card, scenario_path, scenario_name))
    elif args.card and args.scenario:
        tasks.append((args.card, args.scenario, None))
    else:
        log("ERROR: provide --tasks or --card + --scenario")
        sys.exit(1)

    # 确定输出目录
    output_dir = args.output_dir
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    all_results = []
    for card, scenario_path, scenario_name in tasks:
        with open(scenario_path, "r", encoding="utf-8") as f:
            scenario = json.load(f)

        result = run_paired_test(
            server=args.server,
            card=card,
            scenario=scenario,
            api_key=args.api_key,
            model=args.model,
            base_url=args.base_url,
        )
        all_results.append(result)

        # 写入单个结果文件
        if output_dir:
            fname = f"{card}-{scenario['name']}.json"
            out_path = os.path.join(output_dir, fname)
        elif args.output:
            out_path = args.output
        else:
            out_path = f"{card}-{scenario['name']}.json"

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        log(f"Done! {result['totalRounds']} rounds in {result['totalMs']}ms → {out_path}")

    # 多任务模式：输出汇总
    if len(all_results) > 1:
        log(f"All {len(all_results)} tasks completed.")
        for r in all_results:
            log(f"  {r['card']}/{r['scenario']}: {r['totalRounds']} rounds, {r['totalMs']}ms")


if __name__ == "__main__":
    main()
