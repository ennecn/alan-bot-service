#!/usr/bin/env python3
"""Sync 阿凛's config to the other 3 bots: memorySearch + extra skills."""
import paramiko
import json
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

ALIN_DIR = '~/Desktop/p/docker-openclawd/deploy'
OTHER_BOTS = {
    'aling': '~/Desktop/p/docker-openclawd/deploy-aling',
    'lain':  '~/Desktop/p/docker-openclawd/deploy-lain',
    'lumi':  '~/Desktop/p/docker-openclawd/deploy-lumi',
}

EXTRA_SKILLS = [
    'agent-skills', 'browser-use', 'cloudflare-skills',
    'find-skills', 'tavily-search', 'youtube-vision',
]

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

    # Step 1: Read 阿凛's memorySearch config
    print("[1] Reading alin's memorySearch config...")
    out, _, _ = ssh_exec(client, f"jq '.agents.defaults.memorySearch' {ALIN_DIR}/config/openclaw.json")
    memory_search = json.loads(out.strip())
    print(f"    Got memorySearch with provider={memory_search.get('provider')}, model={memory_search.get('model')}")

    # Step 2: Add memorySearch to other bots
    print("\n[2] Adding memorySearch to other bots...")
    for name, path in OTHER_BOTS.items():
        config_file = f"{path}/config/openclaw.json"
        # Check if already has memorySearch
        out, _, _ = ssh_exec(client, f"jq '.agents.defaults.memorySearch' {config_file}")
        if out.strip() != 'null':
            print(f"    {name}: already has memorySearch, skipping")
            continue

        ms_json = json.dumps(memory_search)
        cmd = f"jq '.agents.defaults.memorySearch = {json.dumps(ms_json)}' {config_file}"
        # Use jq --argjson to set the value
        cmd = f"""jq --argjson ms '{ms_json}' '.agents.defaults.memorySearch = $ms' {config_file} > /tmp/oc-{name}.json && mv /tmp/oc-{name}.json {config_file}"""
        out, err, rc = ssh_exec(client, cmd)
        if rc != 0:
            print(f"    {name}: ERROR - {err}")
        else:
            # Verify
            out, _, _ = ssh_exec(client, f"jq '.agents.defaults.memorySearch.provider' {config_file}")
            print(f"    {name}: added memorySearch (provider={out.strip()})")

    # Step 3: Copy extra skills
    print("\n[3] Copying extra skills...")
    for name, path in OTHER_BOTS.items():
        skills_dir = f"{path}/config/skills"
        for skill in EXTRA_SKILLS:
            src = f"{ALIN_DIR}/config/skills/{skill}"
            dst = f"{skills_dir}/{skill}"
            # Check if already exists
            out, _, rc = ssh_exec(client, f"test -d {dst} && echo exists")
            if 'exists' in out:
                print(f"    {name}/{skill}: already exists")
                continue
            out, err, rc = ssh_exec(client, f"cp -r {src} {dst}")
            if rc != 0:
                print(f"    {name}/{skill}: ERROR - {err}")
            else:
                print(f"    {name}/{skill}: copied")

    # Step 4: Verify
    print("\n[4] Verification...")
    for name, path in OTHER_BOTS.items():
        out, _, _ = ssh_exec(client, f"jq '.agents.defaults.memorySearch.provider' {path}/config/openclaw.json")
        ms = out.strip()
        out, _, _ = ssh_exec(client, f"ls {path}/config/skills/ | wc -l")
        skill_count = out.strip()
        out, _, _ = ssh_exec(client, f"ls {path}/config/skills/")
        skills = out.strip().replace('\n', ', ')
        print(f"    {name}: memorySearch={ms}, skills({skill_count}): {skills}")

    # Step 5: Restart containers to pick up config changes
    print("\n[5] Restarting containers...")
    containers = {
        'aling': 'aling-gateway',
        'lain': 'lain-gateway',
        'lumi': 'lumi-gateway',
    }
    for name, container in containers.items():
        out, err, rc = ssh_exec(client, f"docker restart {container}")
        if rc == 0:
            print(f"    {name}: restarted")
        else:
            print(f"    {name}: ERROR - {err}")

    print("\n[6] Done! All 3 bots now match 阿凛's config.")
    client.close()

if __name__ == '__main__':
    main()
