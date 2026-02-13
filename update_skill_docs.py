#!/usr/bin/env python3
"""Update all 4 bots' claude-code SKILL.md to reflect self-send behavior."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

BOTS = {
    'alin':  '~/Desktop/p/docker-openclawd/deploy/config/skills/claude-code/SKILL.md',
    'aling': '~/Desktop/p/docker-openclawd/deploy-aling/config/skills/claude-code/SKILL.md',
    'lain':  '~/Desktop/p/docker-openclawd/deploy-lain/config/skills/claude-code/SKILL.md',
    'lumi':  '~/Desktop/p/docker-openclawd/deploy-lumi/config/skills/claude-code/SKILL.md',
}

OLD_FLOW = """## Completion Flow

When Claude Code finishes:
1. A Telegram notification is sent to the user (via relay bot)
2. Results are injected into your session history via chat.inject
3. You will see the completion in your conversation context"""

NEW_FLOW = """## Completion Flow

When Claude Code finishes:
1. Results are sent to the user's Telegram DM as YOU (the bot), appearing in the same chat thread
2. Results are injected into your session history via chat.inject
3. You will see the completion in your conversation context
4. A backup copy is also sent to the relay group"""

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)
    sftp = client.open_sftp()

    for name, path in BOTS.items():
        expanded = path.replace('~', '/Users/fangjin')
        with sftp.open(expanded, 'r') as f:
            content = f.read().decode()

        if OLD_FLOW in content:
            content = content.replace(OLD_FLOW, NEW_FLOW)
            with sftp.open(expanded, 'w') as f:
                f.write(content)
            print(f"{name}: updated completion flow")
        elif 'as YOU (the bot)' in content:
            print(f"{name}: already updated")
        else:
            print(f"{name}: WARNING - completion flow text not found, manual check needed")

    sftp.close()
    client.close()
    print("\nDone! All SKILL.md files updated.")

if __name__ == '__main__':
    main()
