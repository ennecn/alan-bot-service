#!/usr/bin/env python3
"""Deploy telegram-claude-bot to Mac Mini"""
import paramiko
import os

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
REMOTE_DIR = '/Users/fangjin/telegram-claude-bot'
LOCAL_DIR = os.path.join(os.path.dirname(__file__), 'telegram-claude-bot')

BOT_TOKEN = '7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs'
CHAT_ID = '-1003849405283'

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    sftp = client.open_sftp()

    # Create directories
    for d in [REMOTE_DIR, f'{REMOTE_DIR}/workspace']:
        try:
            sftp.stat(d)
        except FileNotFoundError:
            print(f'Creating {d}')
            stdin, stdout, stderr = client.exec_command(f'mkdir -p {d}')
            stdout.read()

    # Upload files
    for fname in ['bot.js', 'package.json']:
        local = os.path.join(LOCAL_DIR, fname)
        remote = f'{REMOTE_DIR}/{fname}'
        print(f'Uploading {fname}')
        sftp.put(local, remote)

    # Create .env file
    env_content = (
        f'BOT_TOKEN={BOT_TOKEN}\n'
        f'ALLOWED_CHATS={CHAT_ID}\n'
    )
    with sftp.open(f'{REMOTE_DIR}/.env', 'w') as f:
        f.write(env_content)
    print('Created .env')

    # Install dependencies
    print('Installing dependencies...')
    cmd = f'cd {REMOTE_DIR} && /usr/local/bin/npm install --production 2>&1'
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print(f'stderr: {err}')

    # Kill existing bot if running
    print('Stopping existing bot...')
    cmd = "pkill -f 'node.*telegram-claude-bot/bot.js' 2>/dev/null; sleep 1; echo done"
    stdin, stdout, stderr = client.exec_command(cmd)
    stdout.read()

    # Start in tmux for testing
    print('Starting bot in tmux...')
    tmux_cmd = (
        f'/opt/homebrew/bin/tmux kill-session -t tg-claude 2>/dev/null; '
        f'/opt/homebrew/bin/tmux new-session -d -s tg-claude '
        f'"cd {REMOTE_DIR} && '
        f'BOT_TOKEN={BOT_TOKEN} '
        f'ALLOWED_CHATS={CHAT_ID} '
        f'/usr/local/bin/node bot.js 2>&1 | tee bot.log"'
    )
    stdin, stdout, stderr = client.exec_command(tmux_cmd)
    stdout.read()

    # Verify it started
    import time
    time.sleep(3)
    stdin, stdout, stderr = client.exec_command(
        f'/opt/homebrew/bin/tmux capture-pane -t tg-claude -p 2>/dev/null | tail -10'
    )
    output = stdout.read().decode()
    print(f'Bot output:\n{output}')

    sftp.close()
    client.close()
    print('Deploy complete!')

if __name__ == '__main__':
    main()
