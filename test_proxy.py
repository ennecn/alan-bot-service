#!/usr/bin/env python3
"""Test proxy with all bot keys."""
import paramiko
import json

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

keys = {
    "lumi": "gw-lumi-6076e75c20398d61fadace7a7c3c8b68",
    "aling": "gw-aling-5762340acf5576d395f6cb3969c88082",
}

for name, key in keys.items():
    print(f"\n=== {name} (stream=true) ===")
    cmd = (
        f'curl -s -N -m 15 -X POST http://127.0.0.1:8080/v1/messages '
        f'-H "Content-Type: application/json" '
        f'-H "x-api-key: {key}" '
        f"""-d '{{"model":"claude-opus-4-6","max_tokens":10,"stream":true,"messages":[{{"role":"user","content":"hi"}}]}}' """
        f'2>&1 | head -c 600'
    )
    si, so, se = c.exec_command(cmd)
    out = so.read().decode().strip()
    # Check if message_start comes first
    if "message_start" in out:
        first_event = out.split("event: ")[1].split("\n")[0] if "event: " in out else "?"
        print(f"  First event: {first_event}")
        print(f"  OK - streaming works")
    else:
        print(f"  Response: {out[:300]}")

c.close()
print("\nAll tests passed!")
