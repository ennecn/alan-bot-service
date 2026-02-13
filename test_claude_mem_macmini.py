#!/usr/bin/env python3
"""Test claude-mem search on Mac Mini."""
import paramiko
import time
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(f'bash -l -c {repr(cmd)}')
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Check chroma logs
    out, _ = ssh_exec(client, 'ls -t ~/.claude-mem/logs/ | head -1')
    logfile = out.strip()
    out, _ = ssh_exec(client, f'grep -i "chroma\\|vector\\|error" ~/.claude-mem/logs/{logfile} | tail -10')
    print(f"Logs:\n{out}")

    # Save test
    out, _ = ssh_exec(client, '''curl -s -X POST http://127.0.0.1:37777/api/memory/save -H "Content-Type: application/json" -d '{"text":"OpenClaw credential manager stores API tokens centrally","title":"Cred Test","project":"openclaw"}' ''')
    print(f"Save: {out.strip()}")

    time.sleep(3)

    # Search
    out, _ = ssh_exec(client, 'curl -s "http://127.0.0.1:37777/api/search?query=credential&limit=5"')
    print(f"Search: {out.strip()[:500]}")

    # List observations
    out, _ = ssh_exec(client, 'curl -s "http://127.0.0.1:37777/api/observations?limit=5"')
    print(f"\nObservations: {out.strip()[:500]}")

    client.close()

if __name__ == '__main__':
    main()
