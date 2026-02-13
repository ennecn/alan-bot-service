#!/usr/bin/env python3
"""Force restart claude-mem worker on Mac Mini."""
import paramiko
import time
import json

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(f'bash -l -c {repr(cmd)}')
    out = stdout.read().decode()
    err = stderr.read().decode()
    rc = stdout.channel.recv_exit_status()
    return out, err, rc

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Kill all worker processes
    print("[1] Killing all claude-mem workers...")
    out, _, _ = ssh_exec(client, 'pgrep -f "worker-service.cjs" | xargs kill -9 2>/dev/null; echo done')
    print(f"    {out.strip()}")
    time.sleep(2)

    # Verify killed
    out, _, _ = ssh_exec(client, 'pgrep -f "worker-service.cjs" || echo "all killed"')
    print(f"    {out.strip()}")

    # Check DB file
    print("\n[2] Database status...")
    out, _, _ = ssh_exec(client, 'ls -la ~/.claude-mem/claude-mem.db* 2>/dev/null || echo "no db"')
    print(f"    {out.strip()}")

    # Check if chromadb/python is available
    print("\n[3] Checking dependencies...")
    out, _, _ = ssh_exec(client, 'python3 -c "import chromadb; print(chromadb.__version__)" 2>&1')
    print(f"    ChromaDB: {out.strip()}")
    out, _, _ = ssh_exec(client, 'which python3 && python3 --version')
    print(f"    Python: {out.strip()}")

    # Start worker fresh
    print("\n[4] Starting worker...")
    plugin_root = '/Users/fangjin/.claude/plugins/cache/thedotmack/claude-mem/10.0.1'
    # Start in background
    ssh_exec(client, f'cd {plugin_root} && nohup bun scripts/worker-service.cjs start > /tmp/claude-mem-start.log 2>&1 &')
    time.sleep(5)

    out, _, _ = ssh_exec(client, 'cat /tmp/claude-mem-start.log')
    print(f"    Start log: {out.strip()[:300]}")

    out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/health 2>&1')
    print(f"    Health: {out.strip()}")

    # Wait for initialization
    print("\n[5] Waiting for DB init (up to 30s)...")
    for i in range(6):
        time.sleep(5)
        out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/stats 2>&1')
        if 'initializing' not in out:
            print(f"    Stats: {out.strip()[:200]}")
            break
        print(f"    {i*5+5}s: still initializing...")
    else:
        print("    Timeout - checking logs...")
        out, _, _ = ssh_exec(client, 'ls -t ~/.claude-mem/logs/ | head -1')
        logfile = out.strip()
        out, _, _ = ssh_exec(client, f'tail -30 ~/.claude-mem/logs/{logfile}')
        print(out)

    # Test
    print("\n[6] Testing save + search...")
    out, _, _ = ssh_exec(client, '''curl -s -X POST http://127.0.0.1:37777/api/memory/save -H "Content-Type: application/json" -d '{"text":"Test entry: OpenClaw uses Kimi for LLM routing","title":"Test Kimi","project":"test"}' ''')
    print(f"    Save: {out.strip()[:200]}")

    time.sleep(3)

    out, _, _ = ssh_exec(client, 'curl -s "http://127.0.0.1:37777/api/search?query=kimi&limit=5"')
    print(f"    Search: {out.strip()[:300]}")

    client.close()

if __name__ == '__main__':
    main()
