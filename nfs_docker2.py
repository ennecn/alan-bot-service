#!/usr/bin/env python3
"""Check Docker container NAS mounts."""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("192.168.21.111", username="fangjin", password="YYZZ54321!")

DOCKER = "/usr/local/bin/docker"

cmds = [
    (f"{DOCKER} inspect deploy-openclaw-gateway-1 -f '{{{{range .Mounts}}}}{{{{.Source}}}} -> {{{{.Destination}}}} ({{{{.Type}}}})\\n{{{{end}}}}'", "Deploy container mounts"),
    (f"{DOCKER} exec deploy-openclaw-gateway-1 ls -la /mnt/ 2>/dev/null || echo 'no /mnt'", "Deploy /mnt contents"),
    (f"{DOCKER} exec deploy-openclaw-gateway-1 ls -la /mnt/nas/ 2>/dev/null || echo 'no /mnt/nas'", "Deploy /mnt/nas contents"),
    (f"{DOCKER} exec deploy-openclaw-gateway-1 cat /mnt/nas/hello.txt 2>/dev/null || echo 'cannot read'", "Deploy read NAS file"),
    (f"{DOCKER} exec deploy-openclaw-gateway-1 cat /mnt/credentials/env.secrets 2>/dev/null | head -3 || echo 'no creds'", "Deploy credentials mount"),
]

for cmd, label in cmds:
    print(f"\n--- {label} ---")
    print(f"$ {cmd}\n")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(f"[ERR] {err.rstrip()}")

client.close()
