#!/usr/bin/env python3
"""
Wire env.secrets into all 4 bots' docker-compose + create credential-manager skill.
"""
import paramiko
import json

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

BOTS = {
    'alin': {
        'dir': '~/Desktop/p/docker-openclawd/deploy',
        'service': 'openclaw-gateway',
        'container': 'deploy-openclaw-gateway-1',
    },
    'aling': {
        'dir': '~/Desktop/p/docker-openclawd/deploy-aling',
        'service': 'aling-gateway',
        'container': 'aling-gateway',
    },
    'lain': {
        'dir': '~/Desktop/p/docker-openclawd/deploy-lain',
        'service': 'lain-gateway',
        'container': 'lain-gateway',
    },
    'lumi': {
        'dir': '~/Desktop/p/docker-openclawd/deploy-lumi',
        'service': 'lumi-gateway',
        'container': 'lumi-gateway',
    },
}

SKILL_MD = '''---
name: credential-manager
description: "Manage API tokens and credentials. Use when you need to store, retrieve, or use API keys/tokens for services like Cloudflare, Supabase, Vercel, GitHub, etc."
---

# Credential Manager

Centralized credential store shared by all bots. Credentials are stored on Mac Mini and injected into your container as environment variables.

## Reading Credentials (inside container)

Credentials from the store are available as environment variables. For credentials added after container start, source the latest file:

```bash
source /mnt/credentials/env.secrets
echo $CLOUDFLARE_API_TOKEN
```

Or use the exec tool directly:
```json
{"command": "source /mnt/credentials/env.secrets && echo $CREDENTIAL_NAME"}
```

## Adding New Credentials

Use the `nodes` tool to run cred-manager on Mac Mini:

```json
{
  "action": "run",
  "node": "MacMini",
  "command": [
    "/Users/fangjin/cred-manager.sh", "add",
    "CREDENTIAL_NAME", "credential_value", "description of what this is for"
  ]
}
```

Then export to make it available:
```json
{
  "action": "run",
  "node": "MacMini",
  "command": ["/Users/fangjin/cred-manager.sh", "export"]
}
```

After export, the credential is immediately available via `source /mnt/credentials/env.secrets`.

## Listing Credentials

```json
{
  "action": "run",
  "node": "MacMini",
  "command": ["/Users/fangjin/cred-manager.sh", "list"]
}
```

## Deleting Credentials

```json
{
  "action": "run",
  "node": "MacMini",
  "command": ["/Users/fangjin/cred-manager.sh", "delete", "CREDENTIAL_NAME"]
}
```

Then export again to update the env file.

## Using Credentials with CLI Tools

When a skill or tool needs an API token, check if it exists as an env var first. If not, ask the user to provide it, then save it:

1. Check: `source /mnt/credentials/env.secrets && echo $CLOUDFLARE_API_TOKEN`
2. If empty, ask user for the token
3. Save: nodes → `cred-manager.sh add CLOUDFLARE_API_TOKEN <value> "Cloudflare Workers deploy"`
4. Export: nodes → `cred-manager.sh export`
5. Use: `source /mnt/credentials/env.secrets && wrangler deploy`

## Common Credential Names

| Name | Service | Used By |
|------|---------|---------|
| CLOUDFLARE_API_TOKEN | Cloudflare Workers/Pages | wrangler CLI, cloudflare skill |
| SUPABASE_ACCESS_TOKEN | Supabase | supabase CLI |
| VERCEL_TOKEN | Vercel | vercel CLI |
| GITHUB_TOKEN | GitHub API | gh CLI, git push |
| NPM_TOKEN | npm registry | npm publish |

## Important Notes

- **Never expose credential values in chat** - only show names/descriptions
- Credentials are shared across all 4 bots
- Backup runs daily at 3am to NAS
- After adding/deleting, always run `export` to update the env file
- The env file is mounted read-only at `/mnt/credentials/env.secrets`
'''

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    rc = stdout.channel.recv_exit_status()
    return out, err, rc

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    sftp = client.open_sftp()

    # Step 0: Ensure env.secrets exists
    print("[0] Ensuring env.secrets exists...")
    ssh_exec(client, 'bash /Users/fangjin/cred-manager.sh export 2>/dev/null')
    out, _, _ = ssh_exec(client, 'test -f /Users/fangjin/.credentials/env.secrets && echo ok || echo missing')
    print(f"    env.secrets: {out.strip()}")

    # Step 1: Patch docker-compose files
    print("\n[1] Patching docker-compose files...")
    for name, bot in BOTS.items():
        compose_path = bot['dir'].replace('~', '/Users/fangjin') + '/docker-compose.yml'
        with sftp.open(compose_path, 'r') as f:
            content = f.read().decode()

        if 'env_file' in content:
            print(f"    {name}: already has env_file, skipping")
            continue

        if '/mnt/credentials' in content:
            print(f"    {name}: already has credentials mount, skipping")
            continue

        # Add env_file after environment section
        # Find the 'environment:' line and add env_file before it
        lines = content.split('\n')
        new_lines = []
        added_env_file = False
        added_volume = False

        for i, line in enumerate(lines):
            # Add env_file before environment:
            if 'environment:' in line and not added_env_file:
                indent = '    '  # service-level indent
                new_lines.append(f'{indent}env_file:')
                new_lines.append(f'{indent}  - /Users/fangjin/.credentials/env.secrets')
                added_env_file = True

            # Add credentials volume mount
            if line.strip().startswith('- /Users/fangjin/nas:/mnt/nas') and not added_volume:
                new_lines.append(line)
                # Add credentials mount after NAS mount
                indent = line[:len(line) - len(line.lstrip())]
                new_lines.append(f'{indent}- /Users/fangjin/.credentials/env.secrets:/mnt/credentials/env.secrets:ro')
                added_volume = True
                continue

            new_lines.append(line)

        new_content = '\n'.join(new_lines)
        with sftp.open(compose_path, 'w') as f:
            f.write(new_content)
        print(f"    {name}: patched (env_file + volume mount)")

    # Step 2: Create credential-manager skill for all bots
    print("\n[2] Installing credential-manager skill...")
    for name, bot in BOTS.items():
        skill_dir = bot['dir'].replace('~', '/Users/fangjin') + '/config/skills/credential-manager'
        ssh_exec(client, f'mkdir -p {skill_dir}')
        skill_path = f'{skill_dir}/SKILL.md'
        with sftp.open(skill_path, 'w') as f:
            f.write(SKILL_MD)
        print(f"    {name}: installed")

    # Step 3: Restart containers to pick up docker-compose changes
    print("\n[3] Restarting containers...")
    for name, bot in BOTS.items():
        compose_dir = bot['dir'].replace('~', '/Users/fangjin')
        out, err, rc = ssh_exec(client, f'cd {compose_dir} && docker compose up -d 2>&1')
        if rc == 0:
            # Check if container is running
            out2, _, _ = ssh_exec(client, f'docker ps --filter name={bot["container"]} --format "{{{{.Status}}}}"')
            print(f"    {name}: {out2.strip()}")
        else:
            print(f"    {name}: ERROR - {err or out}")

    # Step 4: Verify env vars are available inside containers
    print("\n[4] Verifying credentials mount...")
    for name, bot in BOTS.items():
        out, _, rc = ssh_exec(client, f'docker exec {bot["container"]} test -f /mnt/credentials/env.secrets && echo ok || echo missing')
        print(f"    {name}: /mnt/credentials/env.secrets = {out.strip()}")

    # Step 5: Verify proxy still running
    print("\n[5] Checking proxy status...")
    for name, bot in BOTS.items():
        out, _, _ = ssh_exec(client, f'docker exec {bot["container"]} pgrep -f api-proxy.js 2>/dev/null')
        if out.strip():
            print(f"    {name}: proxy running (pid {out.strip()})")
        else:
            print(f"    {name}: proxy NOT running - restarting...")
            ssh_exec(client, f'docker exec -d {bot["container"]} node /home/node/api-proxy.js')
            out2, _, _ = ssh_exec(client, f'docker exec {bot["container"]} pgrep -f api-proxy.js 2>/dev/null')
            print(f"    {name}: restarted (pid {out2.strip()})")

    sftp.close()
    client.close()
    print("\nDone!")

if __name__ == '__main__':
    main()
