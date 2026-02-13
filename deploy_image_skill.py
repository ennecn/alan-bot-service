#!/usr/bin/env python3
"""Deploy image-gen skill to all 4 OpenClaw bots."""
import paramiko
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

CONTAINERS = [
    'deploy-openclaw-gateway-1',  # Alin
    'lain-gateway',
    'lumi-gateway',
    'aling-gateway',
]

SKILL_DIR = os.path.join(os.path.dirname(__file__), 'skill-image-gen')
REMOTE_SKILL_PATH = '/home/node/.openclaw/skills/image-gen'


def run_cmd(client, cmd):
    cmd = f'export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH && {cmd}'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err


def read_local_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Read local skill files
    skill_md = read_local_file(os.path.join(SKILL_DIR, 'SKILL.md'))
    meta_json = read_local_file(os.path.join(SKILL_DIR, '_meta.json'))
    gen_py = read_local_file(os.path.join(SKILL_DIR, 'scripts', 'gen.py'))

    for container in CONTAINERS:
        print(f'\n{"="*60}')
        print(f'Deploying to: {container}')
        print(f'{"="*60}')

        # Create directories
        run_cmd(client, f'docker exec {container} mkdir -p {REMOTE_SKILL_PATH}/scripts')

        # Write SKILL.md using base64 to avoid shell quoting issues
        import base64
        for filename, content in [
            ('SKILL.md', skill_md),
            ('_meta.json', meta_json),
            ('scripts/gen.py', gen_py),
        ]:
            b64 = base64.b64encode(content.encode('utf-8')).decode()
            remote_path = f'{REMOTE_SKILL_PATH}/{filename}'
            cmd = f'docker exec {container} sh -c "echo {b64} | base64 -d > {remote_path}"'
            out, err = run_cmd(client, cmd)
            if err.strip():
                print(f'  ERROR writing {filename}: {err.strip()}')
            else:
                print(f'  Wrote {filename}')

        # Make gen.py executable
        run_cmd(client, f'docker exec {container} chmod +x {REMOTE_SKILL_PATH}/scripts/gen.py')

        # Verify
        out, err = run_cmd(client, f'docker exec {container} ls -la {REMOTE_SKILL_PATH}/')
        print(f'  Files:\n{out}')

        out, err = run_cmd(client, f'docker exec {container} ls -la {REMOTE_SKILL_PATH}/scripts/')
        print(f'  Scripts:\n{out}')

        # Verify gen.py can be parsed by python3
        out, err = run_cmd(client, f'docker exec {container} python3 -c "import ast; ast.parse(open(\'{REMOTE_SKILL_PATH}/scripts/gen.py\').read()); print(\'OK\')"')
        print(f'  Python syntax check: {out.strip()}')

    # Quick connectivity test from one container
    print(f'\n{"="*60}')
    print('Testing API connectivity from container...')
    print(f'{"="*60}')
    out, err = run_cmd(client, 'docker exec deploy-openclaw-gateway-1 python3 -c "import urllib.request; r=urllib.request.urlopen(urllib.request.Request(\'http://138.68.44.141:8045/v1/models\', headers={\'Authorization\': \'Bearer sk-antigravity-openclaw\'})); print(\'API reachable, status:\', r.status)"')
    print(f'  {out.strip()}')

    client.close()
    print('\nDone! Skill deployed to all 4 bots.')
    print('Note: Bots will auto-discover the skill on next interaction (no restart needed).')


if __name__ == '__main__':
    main()
