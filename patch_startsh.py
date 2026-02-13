#!/usr/bin/env python3
"""Patch all 4 bot start.sh files with skill symlink logic."""
import paramiko

SNIPPET = (
    '# Symlink managed skills to /app/skills/ for read tool path compatibility\n'
    'for d in /home/node/.openclaw/skills/*/; do\n'
    '  sname=$(basename "$d")\n'
    '  [ ! -e "/app/skills/$sname" ] && ln -sf "$d" "/app/skills/$sname"\n'
    'done\n'
    'echo "[$(date)] Managed skills symlinked to /app/skills/"\n\n'
)

MARKER = 'exec node dist/index.js'
BASE = '/Users/fangjin/Desktop/p/docker-openclawd'
DIRS = ['deploy', 'deploy-aling', 'deploy-lain', 'deploy-lumi']


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = c.open_sftp()

    for d in DIRS:
        path = f'{BASE}/{d}/start.sh'

        # Read current file via SFTP (avoids shell expansion)
        with sftp.open(path, 'r') as f:
            content = f.read().decode('utf-8')

        # Remove broken patch if present
        if 'Symlink managed skills' in content:
            lines = content.split('\n')
            new_lines = []
            skip = False
            for line in lines:
                if '# Symlink managed skills' in line:
                    skip = True
                    continue
                if skip:
                    if line.strip().startswith('echo') and 'symlinked' in line.lower():
                        skip = False
                        continue
                    if line.strip() == '':
                        skip = False
                        continue
                    if any(kw in line for kw in ['for d in', 'sname=', '[ ! -e', 'done', 'ln -sf']):
                        continue
                new_lines.append(line)
            content = '\n'.join(new_lines)

        if MARKER not in content:
            print(f'{d}: marker not found!')
            continue

        new_content = content.replace(MARKER, SNIPPET + MARKER)

        # Write via SFTP (binary mode to preserve $ chars)
        with sftp.open(path, 'wb') as f:
            f.write(new_content.encode('utf-8'))

        # Verify
        with sftp.open(path, 'r') as f:
            verify = f.read().decode('utf-8')

        if '$(basename' in verify and '$(date)' in verify:
            print(f'{d}: OK (verified $ preserved)')
        else:
            print(f'{d}: WARNING - $ may have been expanded')

    sftp.close()
    c.close()


if __name__ == '__main__':
    main()
