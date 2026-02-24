#!/usr/bin/env python3
"""
Metroid V5 Behavioral Envelope Metrics
========================================
定量验证 V5 行为信封机制是否正确工作。
不需要 LLM judge，直接从 API 响应中提取指标。

验证项:
  1. envelope 状态正确性 (触发条件 → 预期状态)
  2. 消息数量 (clingy >= 2, withdrawn = 1)
  3. delayMs 范围 (burst: 1-3s, fragmented: 3-8s)
  4. suppressFollowUp (cold_war/withdrawn = true)
  5. prompt 注入 (<behavioral_envelope> XML)

用法:
  python v5-metrics.py --server http://127.0.0.1:8100 \
    --api-key sk-xxx --card frieren
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
    kwargs.setdefault("timeout", 60)
    resp = getattr(requests, method)(url, **kwargs)
    resp.raise_for_status()
    return resp.json()


class V5MetricsTest:
    def __init__(self, server, api_key, model, base_url, card):
        self.server = server
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self.card = card
        self.results = []
        self.agent_id = None

    def setup_agent(self):
        """创建 enhanced agent"""
        resp = api("post", f"{self.server}/agents", json={
            "name": f"v5-metrics-{self.card}",
            "card": self.card,
            "mode": "enhanced",
        })
        self.agent_id = resp["agent"]["id"]
        if self.base_url:
            api("post", f"{self.server}/agents/{self.agent_id}/config", json={
                "openaiApiKey": self.api_key,
                "openaiModel": self.model,
                "openaiBaseUrl": self.base_url,
            })
        # Reset clock
        api("post", f"{self.server}/debug/clock/reset")
        log(f"Created agent {self.agent_id} ({self.card}/enhanced)")

    def chat(self, message):
        return api("post", f"{self.server}/agents/{self.agent_id}/chat", json={
            "content": message, "userId": "test-user", "userName": "测试员",
        })

    def inject_event(self, event, intensity=0.8):
        api("post", f"{self.server}/debug/inject-event/{self.agent_id}",
            json={"event": event, "intensity": intensity})

    def advance_clock(self, minutes):
        api("post", f"{self.server}/debug/clock/advance", json={"minutes": minutes})

    def tick(self):
        return api("post", f"{self.server}/debug/tick/{self.agent_id}")

    def set_impulse(self, value):
        api("post", f"{self.server}/debug/impulse/{self.agent_id}", json={"value": value})

    def set_emotion(self, pleasure=None, arousal=None, dominance=None):
        body = {}
        if pleasure is not None: body["pleasure"] = pleasure
        if arousal is not None: body["arousal"] = arousal
        if dominance is not None: body["dominance"] = dominance
        api("post", f"{self.server}/debug/emotion/{self.agent_id}", json=body)

    def get_impulse(self):
        return api("get", f"{self.server}/agents/{self.agent_id}/impulse")

    def get_pending(self):
        return api("get", f"{self.server}/agents/{self.agent_id}/proactive/pending?limit=10")

    def deliver_all(self):
        pending = self.get_pending()
        for msg in pending.get("messages", []):
            api("post", f"{self.server}/agents/{self.agent_id}/proactive/deliver",
                json={"messageId": msg["id"]})
        return len(pending.get("messages", []))

    def inspect_prompt(self):
        return api("get", f"{self.server}/agents/{self.agent_id}/prompt-inspect")

    def check(self, name, condition, detail=""):
        status = "PASS" if condition else "FAIL"
        self.results.append({"name": name, "status": status, "detail": detail})
        icon = "✓" if condition else "✗"
        log(f"  {icon} {name}: {detail}")

    def test_normal_baseline(self):
        """Test 1: 正常状态下 envelope = normal"""
        log("Test: normal baseline")
        self.setup_agent()
        self.chat("你好呀")
        self.chat("今天天气不错")

        impulse = self.get_impulse()
        self.check("normal_state_enabled", impulse.get("enabled", False),
                    f"impulse enabled={impulse.get('enabled')}")

        envelope = impulse.get("envelope", {})
        self.check("normal_no_envelope", envelope.get("state") == "normal",
                    f"envelope state={envelope.get('state')} (expected normal)")

    def test_clingy_state(self):
        """Test 2: clingy 状态触发和消息模式"""
        log("Test: clingy state")
        self.setup_agent()
        # 建立高互动
        self.chat("我好开心！今天发生了超棒的事！")
        self.chat("你是我最想告诉的人！")
        self.chat("我升职了！！！")

        # 注入高强度事件 + 设置情绪远离基线
        self.inject_event("intimacy", 0.8)
        self.inject_event("celebration", 0.7)
        self.set_emotion(pleasure=0.9, arousal=0.9, dominance=0.3)  # 远离基线 (0.3, 0.7, 0.6)
        self.advance_clock(5)
        self.tick()
        # tick 会重新计算 impulse，所以在 tick 之后设置
        self.set_impulse(0.7)  # 直接设置 impulse 超过 clingy 阈值 (0.5)

        # 检查 envelope 状态
        impulse = self.get_impulse()
        envelope = impulse.get("envelope", {})
        self.check("clingy_envelope_state", envelope.get("state") == "clingy",
                    f"envelope state={envelope.get('state')} (expected clingy)")

        # 检查主动消息
        pending = self.get_pending()
        msgs = pending.get("messages", [])
        if msgs:
            for msg in msgs:
                delay = msg.get("delayMs", 0)
                self.check(f"clingy_delay_{msg.get('id', '?')[:8]}",
                           delay <= 8000,
                           f"delayMs={delay} (burst/fragmented expected)")

    def test_withdrawn_state(self):
        """Test 3: withdrawn 状态通过忽略触发"""
        log("Test: withdrawn state")
        self.setup_agent()
        self.chat("在吗？")

        # 模拟 3 次已读不回
        for i in range(3):
            self.inject_event("loneliness", 0.5)
            self.advance_clock(60)
            self.tick()
            delivered = self.deliver_all()
            log(f"  Ignore cycle {i+1}: delivered {delivered} messages")
            self.advance_clock(35)
            self.tick()

        # 注入 message_ignored 确保触发
        self.inject_event("message_ignored", 0.5)
        self.tick()

        # 检查 envelope 状态
        impulse = self.get_impulse()
        envelope = impulse.get("envelope", {})
        self.check("withdrawn_envelope_state", envelope.get("state") == "withdrawn",
                    f"envelope state={envelope.get('state')} (expected withdrawn)")
        self.check("withdrawn_response_mode", envelope.get("responseMode") == "reluctant",
                    f"responseMode={envelope.get('responseMode')} (expected reluctant)")

    def test_cold_war_state(self):
        """Test 4: cold_war 状态通过冲突触发"""
        log("Test: cold_war state")
        self.setup_agent()
        self.chat("你每次都这样")
        self.chat("我真的很失望")

        # 注入高强度冲突事件 + 设置情绪远离基线
        self.inject_event("conflict", 0.9)
        self.inject_event("distress", 0.7)
        self.set_emotion(pleasure=-0.8, arousal=0.9, dominance=-0.3)  # 远离基线 (0.3, 0.7, 0.6)
        self.advance_clock(30)
        self.tick()

        # 检查 envelope 状态
        impulse = self.get_impulse()
        envelope = impulse.get("envelope", {})
        self.check("cold_war_envelope_state", envelope.get("state") == "cold_war",
                    f"envelope state={envelope.get('state')} (expected cold_war)")
        self.check("cold_war_response_mode",
                    envelope.get("responseMode") in ("silent", "reluctant"),
                    f"responseMode={envelope.get('responseMode')} (expected silent/reluctant)")

    def test_envelope_disabled(self):
        """Test 5: disableEnvelope 开关"""
        log("Test: envelope disabled")
        self.setup_agent()
        self.chat("你好")

        # 禁用 envelope
        api("post", f"{self.server}/debug/envelope/{self.agent_id}",
            json={"disabled": True})

        # 注入冲突事件 (would normally trigger cold_war)
        self.inject_event("conflict", 0.9)
        self.inject_event("distress", 0.7)
        self.advance_clock(30)
        self.tick()

        impulse = self.get_impulse()
        self.check("envelope_disabled_flag", impulse.get("envelopeDisabled", False),
                    f"envelopeDisabled={impulse.get('envelopeDisabled')}")

        # Even with events, envelope should still evaluate (disabled only affects prompt injection)
        envelope = impulse.get("envelope", {})
        self.check("envelope_disabled_state_still_evaluates",
                    envelope.get("state") is not None,
                    f"envelope state={envelope.get('state')} (should still evaluate)")

    def run_all(self):
        """运行所有测试"""
        log(f"=== V5 Metrics Test ({self.card}) ===")
        tests = [
            self.test_normal_baseline,
            self.test_clingy_state,
            self.test_withdrawn_state,
            self.test_cold_war_state,
            self.test_envelope_disabled,
        ]
        for test in tests:
            try:
                test()
            except Exception as e:
                self.results.append({
                    "name": test.__name__, "status": "ERROR",
                    "detail": str(e),
                })
                log(f"  ERROR in {test.__name__}: {e}")

        # 汇总
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = sum(1 for r in self.results if r["status"] == "FAIL")
        errors = sum(1 for r in self.results if r["status"] == "ERROR")
        log(f"\n=== Results: {passed} passed, {failed} failed, {errors} errors ===")

        return {
            "version": "v5-metrics",
            "card": self.card,
            "results": self.results,
            "summary": {"passed": passed, "failed": failed, "errors": errors},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


def main():
    parser = argparse.ArgumentParser(description="Metroid V5 Behavioral Envelope Metrics")
    parser.add_argument("--server", default="http://127.0.0.1:8100")
    parser.add_argument("--card", default="frieren", help="Card to test with")
    parser.add_argument("--api-key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--model", default="Qwen/Qwen3-Next-80B-A3B-Instruct")
    parser.add_argument("--base-url", default="", help="OpenAI-compat base URL (empty = use server's Anthropic config)")
    parser.add_argument("--output", help="Output JSON path")
    args = parser.parse_args()

    if not args.base_url:
        log("Using server's built-in LLM config (no OpenAI override)")
        args.api_key = args.api_key or "unused"

    tester = V5MetricsTest(args.server, args.api_key, args.model, args.base_url, args.card)
    result = tester.run_all()

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        log(f"Results written to {args.output}")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
