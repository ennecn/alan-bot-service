"""
Metroid Bridge Client - 通过 ST 前端扩展截获真实 prompt

用法:
    bridge = MetroidBridge()
    bridge.setup("Rachel.png")
    prompt = bridge.send_and_capture("Hello!")
    # prompt 是 ST 前端真实组装的 messages 数组
"""
import time
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from st_client import STClient


class MetroidBridge:
    def __init__(self, st_url="http://127.0.0.1:8000"):
        self.st_url = st_url.rstrip("/")
        self.client = STClient(st_url)
        self.plugin_base = f"{self.st_url}/api/plugins/metroid-bridge"
        self._session = self.client.session  # reuse CSRF session

    def status(self):
        """Check if the bridge plugin is available."""
        try:
            r = self._session.get(f"{self.plugin_base}/status", timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        return None

    def clear(self):
        """Reset bridge state between test runs."""
        r = self._session.post(f"{self.plugin_base}/clear", json={})
        return r.status_code == 200

    def setup(self, character_file=None, worldinfo_files=None):
        """Import character card and world info books via ST REST API."""
        if character_file:
            self.client.import_character(character_file)
        for wi in (worldinfo_files or []):
            self.client.import_worldinfo(wi)

    def send_and_capture(self, message, character=None, timeout=15, retries=2):
        """
        Send a message through the bridge and capture ST's real prompt.

        1. POST /send-message → queues message for frontend
        2. Frontend polls, triggers Generate, intercepts PROMPT_READY
        3. GET /last-prompt (long-poll) → returns captured messages array

        Returns: list of {role, content} dicts, or None on timeout
        """
        for attempt in range(retries):
            # Clear any stale state
            self.clear()

            # Queue the message
            body = {"message": message}
            if character:
                body["character"] = character
            r = self._session.post(f"{self.plugin_base}/send-message", json=body)
            r.raise_for_status()

            # Long-poll for the captured prompt
            timeout_ms = int(timeout * 1000)
            r = self._session.get(
                f"{self.plugin_base}/last-prompt",
                params={"wait": "true", "timeout": str(timeout_ms)},
                timeout=timeout + 5,
            )
            r.raise_for_status()
            data = r.json()

            if data.get("ok") and data.get("prompt"):
                return data["prompt"]["messages"]

            if attempt < retries - 1:
                print(f"[RETRY] Attempt {attempt + 1} timed out, retrying...")
                time.sleep(1)

        return None

    def compare_prompts(self, st_prompt, other_prompt, label="other"):
        """
        Compare two prompt message arrays and print differences.
        Returns True if they match.
        """
        if len(st_prompt) != len(other_prompt):
            print(f"[DIFF] Message count: ST={len(st_prompt)}, {label}={len(other_prompt)}")

        max_len = max(len(st_prompt), len(other_prompt))
        diffs = 0
        for i in range(max_len):
            st_msg = st_prompt[i] if i < len(st_prompt) else None
            other_msg = other_prompt[i] if i < len(other_prompt) else None

            if st_msg is None:
                print(f"[DIFF] msg[{i}]: ST=MISSING, {label}={other_msg.get('role', '?')}")
                diffs += 1
                continue
            if other_msg is None:
                print(f"[DIFF] msg[{i}]: ST={st_msg.get('role', '?')}, {label}=MISSING")
                diffs += 1
                continue

            if st_msg.get("role") != other_msg.get("role"):
                print(f"[DIFF] msg[{i}] role: ST={st_msg['role']}, {label}={other_msg['role']}")
                diffs += 1

            st_content = st_msg.get("content", "")
            other_content = other_msg.get("content", "")
            if st_content != other_content:
                # Show first difference location
                for j, (a, b) in enumerate(zip(st_content, other_content)):
                    if a != b:
                        ctx = 40
                        print(f"[DIFF] msg[{i}] content differs at char {j}:")
                        print(f"  ST:    ...{st_content[max(0,j-ctx):j+ctx]}...")
                        print(f"  {label}: ...{other_content[max(0,j-ctx):j+ctx]}...")
                        break
                else:
                    if len(st_content) != len(other_content):
                        print(f"[DIFF] msg[{i}] content length: ST={len(st_content)}, {label}={len(other_content)}")
                diffs += 1

        if diffs == 0:
            print(f"[OK] Prompts match perfectly ({len(st_prompt)} messages)")
        else:
            print(f"[DIFF] Total differences: {diffs}")
        return diffs == 0
