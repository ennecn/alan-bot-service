#!/usr/bin/env python3
"""Show final docker-compose.yml for all 4 bots."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

DIRS = [
    ("alin",  "/Users/fangjin/Desktop/p/docker-openclawd/deploy"),
    ("aling", "/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling"),
    ("lain",  "/Users/fangjin/Desktop/p/docker-openclawd/deploy-lain"),
    ("lumi",  "/Users/fangjin/Desktop/p/docker-openclawd/deploy-lumi"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS)

for name, d in DIRS:
    stdin, stdout, stderr = client.exec_command(f"cat {d}/docker-compose.yml")
    out = stdout.read().decode()
    print(f"=== {name} ({d}/docker-compose.yml) ===")
    print(out)
    print()

client.close()
