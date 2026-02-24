#!/usr/bin/env python3
"""
Metroid V5 Behavioral Envelope Test Runner
============================================
三方对比: V5 Enhanced vs V4 Enhanced vs Classic

与 run_test.py 不同，本脚本:
1. 创建 3 个 agent (classic, v4-enhanced, v5-enhanced)
2. 支持 V5 场景的 actions (clock-advance, inject-event, tick, collect-proactive)
3. 收集 chat 回复 + 主动消息

用法:
  python proactive-v5-envelope.py --server http://127.0.0.1:8100 \
    --tasks frieren:clingy-burst yandere:cold-war-standoff \
    --api-key sk-xxx \
    --output-dir ~/nas/metroid-tests/v5-results/
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


def api(method, url, **kwargs):
    """HTTP helper with retry"""
    kwargs.setdefault("timeout", 120)
    for attempt in range(3):
        try:
            resp = getattr(requests, method)(url, **kwargs)
            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                log(f"Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout:
            log(f"Timeout attempt {attempt+1}, retrying...")
            time.sleep(5)
        except Exception as e:
            if attempt < 2:
                time.sleep(10)
            else:
                return {"error": str(e)}
    return {"error": "max retries"}


def create_agent(server, card, mode, api_key, model, base_url, disable_envelope=False):
    """创建 agent 并配置 LLM + envelope 开关"""
    resp = api("post", f"{server}/agents", json={
        "name": f"v5test-{card}-{mode}{'_noenv' if disable_envelope else ''}",
        "card": card,
        "mode": mode,
    })
    if "error" in resp:
        raise RuntimeError(f"Failed to create agent: {resp['error']}")
    agent_id = resp["agent"]["id"]

    # 注入 LLM 配置
    api("post", f"{server}/agents/{agent_id}/config", json={
        "openaiApiKey": api_key,
        "openaiModel": model,
        "openaiBaseUrl": base_url,
    })

    # V5: 禁用 envelope (用于 V4 Enhanced 对照)
    if disable_envelope:
        api("post", f"{server}/debug/envelope/{agent_id}", json={"disabled": True})

    log(f"Created {agent_id} ({card}/{mode}, envelope={'OFF' if disable_envelope else 'ON'})")
    return agent_id


def chat(server, agent_id, message):
    """发送消息并返回完整响应"""
    return api("post", f"{server}/agents/{agent_id}/chat", json={
        "content": message,
        "userId": "test-user",
        "userName": "测试员",
    })


def execute_actions(server, agent_id, actions):
    """执行 V5 场景 actions (clock, inject-event, tick, etc.)"""
    proactive_messages = []
    for action in actions:
        atype = action["type"]
        if atype == "inject-event":
            body = {"event": action["event"]}
            if "intensity" in action:
                body["intensity"] = action["intensity"]
            if "decayRate" in action:
                body["decayRate"] = action["decayRate"]
            if "relevance" in action:
                body["relevance"] = action["relevance"]
            api("post", f"{server}/debug/inject-event/{agent_id}", json=body)
        elif atype == "clock-advance":
            api("post", f"{server}/debug/clock/advance", json={"minutes": action["minutes"]})
        elif atype == "tick":
            api("post", f"{server}/debug/tick/{agent_id}")
        elif atype == "collect-proactive":
            resp = api("get", f"{server}/agents/{agent_id}/proactive/pending?limit=10")
            if "messages" in resp:
                proactive_messages.extend(resp["messages"])
        elif atype == "deliver-all":
            resp = api("get", f"{server}/agents/{agent_id}/proactive/pending?limit=10")
            for msg in resp.get("messages", []):
                api("post", f"{server}/agents/{agent_id}/proactive/deliver",
                    json={"messageId": msg["id"]})
    return proactive_messages


def get_impulse_state(server, agent_id):
    """获取 impulse 状态 (含 envelope 信息)"""
    return api("get", f"{server}/agents/{agent_id}/impulse")


def run_v5_test(server, card, scenario, api_key, model, base_url):
    """三方对比: Classic vs V4 Enhanced vs V5 Enhanced"""
    log(f"Starting V5 test: {card} / {scenario['name']}")

    # 创建 3 个 agent
    classic_id = create_agent(server, card, "classic", api_key, model, base_url)
    v4_id = create_agent(server, card, "enhanced", api_key, model, base_url, disable_envelope=True)
    v5_id = create_agent(server, card, "enhanced", api_key, model, base_url, disable_envelope=False)

    agent_ids = {"classic": classic_id, "v4_enhanced": v4_id, "v5_enhanced": v5_id}
    rounds = []
    proactive_collected = {"classic": [], "v4_enhanced": [], "v5_enhanced": []}
    total_start = time.time()

    # 重置 debug clock
    api("post", f"{server}/debug/clock/reset")

    for phase in scenario["phases"]:
        phase_name = phase["name"]
        messages = phase.get("messages", [])
        actions = phase.get("actions", [])
        actions_after = phase.get("actions_after", [])
        repeat = phase.get("repeat", 1)

        log(f"Phase: {phase_name} (msgs={len(messages)}, actions={len(actions)}, repeat={repeat})")

        for rep in range(repeat):
            # 执行 pre-actions (对所有 agent)
            if actions:
                for label, aid in agent_ids.items():
                    msgs = execute_actions(server, aid, actions)
                    proactive_collected[label].extend(msgs)

            # 发送 chat 消息
            for i, user_msg in enumerate(messages):
                round_start = time.time()
                responses = {}
                for label, aid in agent_ids.items():
                    responses[label] = chat(server, aid, user_msg)
                round_ms = int((time.time() - round_start) * 1000)

                # 获取 impulse 状态
                impulse_states = {}
                for label, aid in agent_ids.items():
                    impulse_states[label] = get_impulse_state(server, aid)

                rnd = {
                    "phase": phase_name,
                    "repeat": rep if repeat > 1 else None,
                    "round": i,
                    "user": user_msg,
                    "roundMs": round_ms,
                }
                for label in agent_ids:
                    resp = responses[label]
                    rnd[label] = {
                        "response": resp.get("response", ""),
                        "emotion": resp.get("emotion"),
                        "growthChanges": resp.get("growthChanges", 0),
                        "timing": resp.get("timing"),
                        "voiceHint": resp.get("voiceHint"),
                        "error": resp.get("error"),
                        "impulse": impulse_states.get(label),
                    }
                rounds.append(rnd)
                log(f"  [{phase_name}][{i}] done ({round_ms}ms)")
                time.sleep(1)

            # 执行 post-actions
            if actions_after:
                for label, aid in agent_ids.items():
                    msgs = execute_actions(server, aid, actions_after)
                    proactive_collected[label].extend(msgs)

        # 收集 proactive messages (if flagged)
        if phase.get("collectProactive"):
            for label, aid in agent_ids.items():
                resp = api("get", f"{server}/agents/{aid}/proactive/pending?limit=10")
                proactive_collected[label].extend(resp.get("messages", []))

    total_ms = int((time.time() - total_start) * 1000)

    result = {
        "version": "v5-envelope",
        "card": card,
        "scenario": scenario["name"],
        "agents": agent_ids,
        "model": model,
        "baseUrl": base_url,
        "dimensions": scenario.get("dimensions", []),
        "rounds": rounds,
        "proactiveMessages": proactive_collected,
        "totalRounds": len(rounds),
        "totalMs": total_ms,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return result


def resolve_scenario_path(scenario_ref, script_dir):
    """解析 scenario 路径"""
    if os.path.isfile(scenario_ref):
        return scenario_ref
    candidate = os.path.join(script_dir, "scenarios", f"{scenario_ref}.json")
    if os.path.isfile(candidate):
        return candidate
    return scenario_ref


def main():
    parser = argparse.ArgumentParser(description="Metroid V5 Behavioral Envelope Test Runner")
    parser.add_argument("--server", default="http://127.0.0.1:8100")
    parser.add_argument("--tasks", nargs="+", required=True,
                        help="card:scenario pairs (e.g. frieren:clingy-burst)")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--api-key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--model", default="Qwen/Qwen3-Next-80B-A3B-Instruct")
    parser.add_argument("--base-url", default="https://api.siliconflow.cn/v1")
    args = parser.parse_args()

    if not args.api_key:
        log("ERROR: --api-key or SILICONFLOW_API_KEY required")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(args.output_dir, exist_ok=True)

    all_results = []
    for task_spec in args.tasks:
        parts = task_spec.split(":", 1)
        if len(parts) != 2:
            log(f"ERROR: invalid task spec '{task_spec}', expected card:scenario")
            sys.exit(1)
        card, scenario_name = parts
        scenario_path = resolve_scenario_path(scenario_name, script_dir)

        with open(scenario_path, "r", encoding="utf-8") as f:
            scenario = json.load(f)

        result = run_v5_test(
            server=args.server, card=card, scenario=scenario,
            api_key=args.api_key, model=args.model, base_url=args.base_url,
        )
        all_results.append(result)

        out_path = os.path.join(args.output_dir, f"{card}-{scenario['name']}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        log(f"Done! {result['totalRounds']} rounds in {result['totalMs']}ms → {out_path}")

    if len(all_results) > 1:
        log(f"All {len(all_results)} tasks completed.")
        for r in all_results:
            log(f"  {r['card']}/{r['scenario']}: {r['totalRounds']} rounds, {r['totalMs']}ms")


if __name__ == "__main__":
    main()
