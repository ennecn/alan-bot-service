import paramiko
import sys

HOST = '192.168.21.111'
USERNAME = 'fangjin'
PASSWORD = 'YYZZ54321!'

COMMANDS = [
    ('1. OpenClaw-related processes',
     'ps aux | grep -i openclaw | grep -v grep'),

    ('2. Node.js / gateway / proxy / bridge processes',
     'ps aux | grep -E "node|gateway|proxy|bridge" | grep -v grep'),

    ('3. OpenClaw config files (openclaw.json, models.json, auth.json, .env)',
     r"""find /Users/fangjin -maxdepth 5 \( -name 'openclaw.json' -o -name 'models.json' -o -name 'auth.json' -o -name '.env' \) 2>/dev/null | grep -i openclaw"""),

    ('4. OpenClaw agent directory',
     r"""ls -la ~/.openclaw/ 2>/dev/null || ls -la ~/Library/Application\ Support/openclaw/ 2>/dev/null || echo 'Not found in standard locations'"""),

    ('5a. Telegram-related processes',
     'ps aux | grep -i telegram | grep -v grep'),

    ('5b. Forwarding-related processes',
     'ps aux | grep -i forward | grep -v grep'),

    ('5c. Notify-related processes',
     'ps aux | grep -i notify | grep -v grep'),

    ('6. Ports listening (8080,8045,8047,9090,3000,4000,5000,7860,8888)',
     r"""lsof -i -P | grep LISTEN | grep -E ':(8080|8045|8047|9090|3000|4000|5000|7860|8888)' | head -20"""),

    ('7. launchctl services (openclaw/gateway/llm/bridge/telegram/forward/notify)',
     r"""launchctl list | grep -i -E 'openclaw|gateway|llm|bridge|telegram|forward|notify'"""),

    ('8. Docker containers',
     r"""docker ps 2>/dev/null || echo 'Docker not running'"""),

    ('9. LLM gateway / openclaw directories',
     r"""ls -la ~/llm-gateway/ 2>/dev/null; echo '---'; ls -la ~/openclaw/ 2>/dev/null"""),

    ('10. Crontab entries',
     'crontab -l 2>/dev/null'),
]

def main():
    print('=' * 70)
    print(f'  Mac Mini Inspection  -  {HOST}')
    print('=' * 70 + '\n')

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f'Connecting to {HOST} as {USERNAME} ...')
        client.connect(HOST, port=22, username=USERNAME, password=PASSWORD, timeout=15)
        print('Connected.\n')
    except Exception as e:
        print(f'SSH connection failed: {e}')
        sys.exit(1)

    for header, cmd in COMMANDS:
        print('\n' + chr(9472) * 70)
        print(f'  {header}')
        print(f'  CMD: {cmd}')
        print(chr(9472) * 70)
        try:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
            out = stdout.read().decode('utf-8', errors='replace').strip()
            err = stderr.read().decode('utf-8', errors='replace').strip()
            if out:
                print(out)
            elif err:
                print(f'(stderr) {err}')
            else:
                print('(no output)')
        except Exception as e:
            print(f'Error running command: {e}')

    client.close()
    print('\n' + '=' * 70)
    print('  Inspection complete.')
    print('=' * 70)

if __name__ == '__main__':
    main()
