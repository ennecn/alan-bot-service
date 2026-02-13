#!/usr/bin/env python3
"""Restart all 4 bot containers to pick up docker-compose changes (env_file + volume)."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

BOTS = [
    ('alin', '/Users/fangjin/Desktop/p/docker-openclawd/deploy', 'deploy-openclaw-gateway-1'),
    ('aling', '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling', 'aling-gateway'),
    ('lain', '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lain', 'lain-gateway'),
    ('lumi', '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lumi', 'lumi-gateway'),
]

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

    # Verify docker-compose changes
    print("[1] Verifying docker-compose patches...")
    for name, path, container in BOTS:
        out, _, _ = ssh_exec(client, f'grep -c "env_file\\|mnt/credentials" {path}/docker-compose.yml')
        print(f"    {name}: {out.strip()} patch lines found")

    # Restart containers
    print("\n[2] Restarting containers (docker compose up -d)...")
    for name, path, container in BOTS:
        out, err, rc = ssh_exec(client, f'cd {path} && docker compose up -d')
        status_out, _, _ = ssh_exec(client, f'docker ps --filter name={container} --format "{{{{.Status}}}}"')
        print(f"    {name}: {status_out.strip()}")

    # Wait a moment for containers to stabilize
    import time
    time.sleep(5)

    # Verify credentials mount
    print("\n[3] Verifying /mnt/credentials/env.secrets...")
    for name, path, container in BOTS:
        out, _, _ = ssh_exec(client, f'docker exec {container} cat /mnt/credentials/env.secrets 2>&1 | head -3')
        print(f"    {name}: {out.strip()[:80]}")

    # Restart proxies (they die on container restart)
    print("\n[4] Restarting api-proxy in each container...")
    for name, path, container in BOTS:
        ssh_exec(client, f'docker exec -d {container} node /home/node/api-proxy.js')
        import time; time.sleep(1)
        out, _, _ = ssh_exec(client, f'docker exec {container} pgrep -f api-proxy.js')
        print(f"    {name}: proxy pid={out.strip()}")

    # Quick health check
    print("\n[5] Health check...")
    for name, path, container in BOTS:
        out, _, _ = ssh_exec(client, f'docker exec {container} curl -s http://127.0.0.1:8022/health 2>/dev/null | head -1')
        print(f"    {name}: {out.strip()[:100]}")

    client.close()
    print("\nDone!")

if __name__ == '__main__':
    main()
