#!/usr/bin/env python3
"""Install uv + chromadb on Mac Mini for claude-mem vector search."""
import paramiko
import time

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

def ssh_exec(client, cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(f'bash -l -c {repr(cmd)}', timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    rc = stdout.channel.recv_exit_status()
    return out, err, rc

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Install uv
    print("[1] Installing uv...")
    out, err, rc = ssh_exec(client, 'which uvx 2>/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh)', timeout=60)
    print(f"    {out.strip()[-200:]}")
    if err and 'error' in err.lower():
        print(f"    ERR: {err.strip()[-200:]}")

    # Verify uvx
    out, _, _ = ssh_exec(client, 'which uvx || echo "not found"')
    print(f"    uvx: {out.strip()}")

    if 'not found' in out:
        # Try sourcing the env
        out, _, _ = ssh_exec(client, 'source ~/.local/bin/env 2>/dev/null; which uvx')
        print(f"    uvx (after source): {out.strip()}")

    # Restart worker
    print("\n[2] Restarting worker...")
    ssh_exec(client, 'pgrep -f "worker-service.cjs" | xargs kill -9 2>/dev/null')
    time.sleep(2)

    plugin_root = '/Users/fangjin/.claude/plugins/cache/thedotmack/claude-mem/10.0.1'
    ssh_exec(client, f'cd {plugin_root} && nohup bun scripts/worker-service.cjs start > /tmp/claude-mem-start.log 2>&1 &')
    time.sleep(5)

    out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/health')
    print(f"    Health: {out.strip()}")

    # Wait for ChromaDB to initialize (first time may download)
    print("\n[3] Waiting for ChromaDB init (may take a minute on first run)...")
    for i in range(12):
        time.sleep(5)
        out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/stats 2>&1')
        if 'error' not in out.lower() or 'initializing' not in out.lower():
            print(f"    Stats: {out.strip()[:200]}")
            break
        print(f"    {i*5+5}s: {out.strip()[:100]}")
    else:
        print("    Still initializing after 60s, checking logs...")

    # Check logs for chroma status
    print("\n[4] ChromaDB status in logs...")
    out, _, _ = ssh_exec(client, 'ls -t ~/.claude-mem/logs/ | head -1')
    logfile = out.strip()
    out, _, _ = ssh_exec(client, f'grep -i "chroma\\|vector\\|uvx\\|error" ~/.claude-mem/logs/{logfile} | tail -10')
    print(f"    {out.strip()}")

    # Test search
    print("\n[5] Testing save + search...")
    out, _, _ = ssh_exec(client, '''curl -s -X POST http://127.0.0.1:37777/api/memory/save -H "Content-Type: application/json" -d '{"text":"OpenClaw credential manager stores API tokens centrally on Mac Mini","title":"Credential Store","project":"openclaw"}' ''')
    print(f"    Save: {out.strip()[:200]}")

    time.sleep(3)

    out, _, _ = ssh_exec(client, 'curl -s "http://127.0.0.1:37777/api/search?query=credential&limit=5"')
    print(f"    Search: {out.strip()[:300]}")

    client.close()

if __name__ == '__main__':
    main()
