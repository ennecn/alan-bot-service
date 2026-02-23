#!/usr/bin/env python3
"""
Metroid Preflight Check
========================
在正式测试前验证环境是否就绪。

用法:
  python preflight.py --server http://127.0.0.1:8100 --api-key sk-xxx

退出码: 0=全部通过, 1=有失败项
"""

import argparse
import json
import os
import sys
import requests


def check(name, fn):
    try:
        ok, detail = fn()
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}: {detail}")
        return ok
    except Exception as e:
        print(f"  [FAIL] {name}: {e}")
        return False


def check_server(server):
    def _check():
        resp = requests.get(f"{server}/health", timeout=10)
        data = resp.json()
        return data.get("status") == "ok", f"agents={data.get('agents', 0)}, uptime={data.get('uptime', 0):.0f}s"
    return _check


def check_api_key(api_key, base_url, model):
    def _check():
        resp = requests.post(f"{base_url}/chat/completions", json={
            "model": model,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 5,
        }, headers={
            "Authorization": f"Bearer {api_key}",
        }, timeout=30)
        if resp.status_code == 200:
            return True, "API key valid"
        elif resp.status_code == 429:
            return True, "API key valid (rate limited but auth OK)"
        else:
            return False, f"HTTP {resp.status_code}: {resp.text[:100]}"
    return _check


def check_python_deps():
    def _check():
        import requests  # noqa
        return True, "requests available"
    return _check


def check_scenario_file(path):
    def _check():
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        phases = data.get("phases", [])
        total_msgs = sum(len(p.get("messages", [])) for p in phases)
        return True, f"{data['name']}: {len(phases)} phases, {total_msgs} messages"
    return _check


def check_output_dir(path):
    def _check():
        os.makedirs(path, exist_ok=True)
        test_file = os.path.join(path, ".preflight-test")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return True, f"{path} writable"
    return _check


def main():
    parser = argparse.ArgumentParser(description="Metroid Preflight Check")
    parser.add_argument("--server", default="http://127.0.0.1:8100")
    parser.add_argument("--api-key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--model", default="Qwen/Qwen3-Next-80B-A3B-Instruct")
    parser.add_argument("--base-url", default="https://api.siliconflow.cn/v1")
    parser.add_argument("--scenario", default="")
    parser.add_argument("--output-dir", default="./results")
    args = parser.parse_args()

    print("Metroid Preflight Check")
    print("=" * 40)

    results = []
    results.append(check("Test Server", check_server(args.server)))
    results.append(check("Python deps", check_python_deps()))

    if args.api_key:
        results.append(check("LLM API Key", check_api_key(args.api_key, args.base_url, args.model)))
    else:
        print("  [SKIP] LLM API Key: no --api-key provided")

    if args.scenario:
        results.append(check("Scenario file", check_scenario_file(args.scenario)))

    results.append(check("Output dir", check_output_dir(args.output_dir)))

    print("=" * 40)
    passed = sum(results)
    total = len(results)
    print(f"Result: {passed}/{total} passed")

    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
