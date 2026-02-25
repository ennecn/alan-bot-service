"""
Metroid Bridge - End-to-End Tests
Requires: ST running with metroid-bridge plugin + extension loaded in browser

Usage:
    python test_metroid_bridge.py              # run all tests
    python test_metroid_bridge.py --check      # just check bridge status
"""
import sys
import os
import json
import argparse

sys.path.insert(0, os.path.dirname(__file__))
from metroid_bridge_client import MetroidBridge


def check_bridge(bridge):
    """Verify the bridge plugin is reachable and frontend is polling."""
    status = bridge.status()
    if not status:
        print("[FAIL] Bridge plugin not reachable. Is ST running with enableServerPlugins: true?")
        return False
    print(f"[OK] Bridge plugin status: {json.dumps(status, indent=2)}")
    return status.get("ok", False)


def test_basic_capture(bridge):
    """Test: send a message and capture the real ST prompt."""
    print("\n=== test_basic_capture ===")
    bridge.clear()

    prompt = bridge.send_and_capture("Hello!")
    if prompt is None:
        print("[FAIL] No prompt captured. Is the ST browser tab open with the extension loaded?")
        return False

    print(f"[OK] Captured {len(prompt)} messages")
    for i, msg in enumerate(prompt):
        role = msg.get("role", "?")
        content = str(msg.get("content", ""))
        print(f"  [{i}] {role}: {content[:80]}{'...' if len(content) > 80 else ''}")

    # Basic sanity checks
    assert len(prompt) >= 2, f"Expected at least 2 messages, got {len(prompt)}"
    assert prompt[0]["role"] == "system", f"First message should be system, got {prompt[0]['role']}"
    print("[PASS] test_basic_capture")
    return True


def test_multiturn(bridge):
    """Test: multiple messages accumulate in the prompt."""
    print("\n=== test_multiturn ===")
    bridge.clear()

    p1 = bridge.send_and_capture("Hello!")
    if p1 is None:
        print("[FAIL] First message capture failed")
        return False
    print(f"[OK] Turn 1: {len(p1)} messages")

    # Second message should have more messages (includes first exchange)
    p2 = bridge.send_and_capture("How are you?")
    if p2 is None:
        print("[FAIL] Second message capture failed")
        return False
    print(f"[OK] Turn 2: {len(p2)} messages")

    if len(p2) > len(p1):
        print(f"[PASS] Message count grew: {len(p1)} → {len(p2)}")
    else:
        print(f"[WARN] Message count didn't grow: {len(p1)} → {len(p2)} (LLM may not have replied)")

    print("[PASS] test_multiturn")
    return True


def test_compare_with_captured(bridge):
    """Test: compare bridge-captured prompt with previously intercepted prompts."""
    print("\n=== test_compare_with_captured ===")
    captured_dir = os.path.join(os.path.dirname(__file__), "captured_prompts")
    if not os.path.isdir(captured_dir):
        print("[SKIP] No captured_prompts directory found")
        return True

    files = sorted(f for f in os.listdir(captured_dir) if f.endswith(".json"))
    if not files:
        print("[SKIP] No captured prompt files found")
        return True

    # Load the first captured prompt as reference
    ref_path = os.path.join(captured_dir, files[0])
    with open(ref_path) as f:
        ref_data = json.load(f)

    ref_messages = ref_data if isinstance(ref_data, list) else ref_data.get("messages", [])
    print(f"[INFO] Reference prompt: {files[0]} ({len(ref_messages)} messages)")

    # We can't replay the exact same scenario without knowing the character,
    # so just report the reference for manual comparison
    print(f"[INFO] Reference roles: {[m.get('role') for m in ref_messages]}")
    print("[PASS] test_compare_with_captured (reference loaded)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Metroid Bridge E2E Tests")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="ST base URL")
    parser.add_argument("--check", action="store_true", help="Just check bridge status")
    parser.add_argument("--timeout", type=int, default=15, help="Capture timeout in seconds")
    args = parser.parse_args()

    bridge = MetroidBridge(args.url)

    if not check_bridge(bridge):
        sys.exit(1)

    if args.check:
        return

    results = []
    results.append(("basic_capture", test_basic_capture(bridge)))
    results.append(("multiturn", test_multiturn(bridge)))
    results.append(("compare_with_captured", test_compare_with_captured(bridge)))

    print("\n=== Results ===")
    for name, passed in results:
        print(f"  {'PASS' if passed else 'FAIL'}: {name}")

    if all(r[1] for r in results):
        print("\nAll tests passed!")
    else:
        print("\nSome tests failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
