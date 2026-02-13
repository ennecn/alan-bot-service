#!/usr/bin/env python3
"""Patch dispatch script to accept -P port parameter"""
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

sftp = c.open_sftp()
with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "rb") as f:
    content = f.read().decode("utf-8")
sftp.close()

if "gateway_port" in content:
    print("Already patched!")
else:
    # 1. Add GATEWAY_PORT variable
    content = content.replace(
        'PERMISSION_MODE=""',
        'PERMISSION_MODE=""\nGATEWAY_PORT="18789"'
    )
    # 2. Add -P case
    content = content.replace(
        '-m|--permission-mode) PERMISSION_MODE="$2"; shift 2;;',
        '-m|--permission-mode) PERMISSION_MODE="$2"; shift 2;;\n        -P|--port) GATEWAY_PORT="$2"; shift 2;;'
    )
    # 3. Add --arg port to jq
    content = content.replace(
        '--arg perm "$PERMISSION_MODE"',
        '--arg perm "$PERMISSION_MODE" \\\n    --arg port "$GATEWAY_PORT"'
    )
    # 4. Add gateway_port to jq output
    content = content.replace(
        "permission_mode: $perm",
        "permission_mode: $perm, gateway_port: $port"
    )

    sftp = c.open_sftp()
    with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "wb") as f:
        f.write(content.encode("utf-8"))
    sftp.close()

    # Verify
    sftp = c.open_sftp()
    with sftp.open("/Users/fangjin/claude-code-dispatch.sh", "rb") as f:
        verify = f.read().decode("utf-8")
    sftp.close()

    checks = {
        "GATEWAY_PORT var": "GATEWAY_PORT=" in verify,
        "-P case": "--port)" in verify,
        "jq arg": "--arg port" in verify,
        "jq output": "gateway_port: $port" in verify,
    }
    for k, v in checks.items():
        print(f"  {k}: {'OK' if v else 'MISSING'}")

c.close()
print("Done")
