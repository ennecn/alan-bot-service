#!/usr/bin/env python3
"""Deploy cred-manager.sh to Mac Mini and set up auto-backup."""
import paramiko

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

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

    # Step 1: Upload cred-manager.sh
    print("[1] Uploading cred-manager.sh...")
    sftp = client.open_sftp()
    sftp.put(r'D:\openclawVPS\cred-manager.sh', '/Users/fangjin/cred-manager.sh')
    sftp.close()
    ssh_exec(client, 'chmod +x /Users/fangjin/cred-manager.sh')
    print("    Done")

    # Step 2: Initialize store
    print("[2] Initializing credential store...")
    out, err, rc = ssh_exec(client, '/Users/fangjin/cred-manager.sh list')
    print(f"    {out.strip()}")

    # Step 3: Create daily backup launchd plist
    print("[3] Setting up daily NAS backup (launchd)...")
    plist = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.cred-backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/fangjin/cred-manager.sh</string>
        <string>backup</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/cred-backup.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/cred-backup.log</string>
</dict>
</plist>'''

    plist_path = '/Users/fangjin/Library/LaunchAgents/com.openclaw.cred-backup.plist'
    sftp = client.open_sftp()
    with sftp.open(plist_path, 'w') as f:
        f.write(plist)
    sftp.close()

    # Load the launchd job
    ssh_exec(client, f'launchctl unload {plist_path} 2>/dev/null; launchctl load {plist_path}')
    out, _, _ = ssh_exec(client, 'launchctl list | grep cred-backup')
    print(f"    Launchd job: {out.strip() or 'loaded (idle until 3am)'}")

    # Step 4: Do initial backup
    print("[4] Running initial backup...")
    out, err, rc = ssh_exec(client, '/Users/fangjin/cred-manager.sh backup')
    print(f"    {out.strip()}")

    # Step 5: Verify
    print("\n[5] Verification:")
    out, _, _ = ssh_exec(client, 'ls -la /Users/fangjin/.credentials/')
    print(f"    Store dir:\n{out}")
    out, _, _ = ssh_exec(client, 'ls -la /Users/fangjin/nas/.credentials/')
    print(f"    NAS backup:\n{out}")

    print("\nUsage:")
    print("  SSH to Mac Mini, then:")
    print("  ~/cred-manager.sh add CLOUDFLARE_API_TOKEN <token> 'Cloudflare deploy'")
    print("  ~/cred-manager.sh list")
    print("  ~/cred-manager.sh export    # generates env.secrets for docker-compose")
    print("  ~/cred-manager.sh backup    # manual backup to NAS")

    client.close()

if __name__ == '__main__':
    main()
