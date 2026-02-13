#!/usr/bin/env python3
"""Configure claude-mem on Mac Mini with Gemini embedding."""
import paramiko
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

    # Check worker
    print("[1] Worker status...")
    out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/health')
    print(f"    {out.strip()}")

    out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/stats')
    print(f"    Stats: {out.strip()}")

    # Check logs
    print("\n[2] Recent logs...")
    out, _, _ = ssh_exec(client, 'ls -t ~/.claude-mem/logs/ | head -1')
    logfile = out.strip()
    if logfile:
        out, _, _ = ssh_exec(client, f'tail -20 ~/.claude-mem/logs/{logfile}')
        print(out)

    # Update settings - switch to gemini provider
    print("[3] Updating settings...")
    out, _, _ = ssh_exec(client, 'cat ~/.claude-mem/settings.json')
    settings = json.loads(out)

    settings['CLAUDE_MEM_PROVIDER'] = 'gemini'
    settings['CLAUDE_MEM_GEMINI_API_KEY'] = 'AIzaSyAG15eG4RIr7l-DPuDT2jUL5Lk8uHVpZUE'
    settings['CLAUDE_MEM_GEMINI_MODEL'] = 'gemini-2.5-flash-lite'
    settings['CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED'] = 'true'

    sftp = client.open_sftp()
    with sftp.open('/Users/fangjin/.claude-mem/settings.json', 'w') as f:
        f.write(json.dumps(settings, indent=2))
    sftp.close()
    print("    Provider: gemini, API key: set, Model: gemini-2.5-flash-lite")

    # Restart worker
    print("\n[4] Restarting worker...")
    plugin_root = '/Users/fangjin/.claude/plugins/cache/thedotmack/claude-mem/10.0.1'
    out, err, rc = ssh_exec(client, f'curl -s -X POST http://127.0.0.1:37777/api/shutdown 2>/dev/null; sleep 2; bun {plugin_root}/scripts/worker-service.cjs start 2>&1')
    print(f"    {out.strip()[:200]}")

    import time; time.sleep(3)

    out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/health')
    print(f"    Health: {out.strip()}")

    out, _, _ = ssh_exec(client, 'curl -s http://127.0.0.1:37777/api/stats')
    print(f"    Stats: {out.strip()}")

    # Check if vector search is enabled (no Windows limitation)
    print("\n[5] Checking logs for vector search status...")
    out, _, _ = ssh_exec(client, 'ls -t ~/.claude-mem/logs/ | head -1')
    logfile = out.strip()
    if logfile:
        out, _, _ = ssh_exec(client, f'grep -i "vector\\|chroma\\|disabled" ~/.claude-mem/logs/{logfile} | tail -5')
        if out.strip():
            print(f"    {out.strip()}")
        else:
            print("    No vector/chroma messages (good - not disabled)")

    # Test save + search
    print("\n[6] Testing save + search...")
    out, _, _ = ssh_exec(client, '''curl -s -X POST http://127.0.0.1:37777/api/memory/save -H "Content-Type: application/json" -d '{"text":"OpenClaw bots use Kimi provider for LLM routing on Mac Mini","title":"Test: Kimi routing","project":"openclaw"}' ''')
    print(f"    Save: {out.strip()}")

    import time; time.sleep(2)

    out, _, _ = ssh_exec(client, 'curl -s "http://127.0.0.1:37777/api/search?query=kimi+routing&limit=5"')
    print(f"    Search: {out.strip()[:300]}")

    client.close()
    print("\nDone!")

if __name__ == '__main__':
    main()
