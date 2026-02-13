#!/usr/bin/env python3
import paramiko
import sys

def deploy():
    # Read local file
    with open('anthropic-proxy.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Connect to VPS
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('138.68.44.141', port=2222, username='root')
    
    # Upload file via SFTP
    sftp = client.open_sftp()
    with sftp.file('/root/anthropic-proxy.js', 'w') as f:
        f.write(content)
    sftp.close()
    print("File uploaded to /root/anthropic-proxy.js")
    
    # Create systemd service
    service_content = '''[Unit]
Description=Anthropic to OpenAI API Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
ExecStart=/usr/bin/node /root/anthropic-proxy.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
'''
    
    stdin, stdout, stderr = client.exec_command(f"cat > /etc/systemd/system/anthropic-proxy.service << 'EOF'\n{service_content}EOF")
    stdout.read()
    print("Systemd service created")
    
    # Reload and start service
    commands = [
        'systemctl daemon-reload',
        'systemctl enable anthropic-proxy',
        'systemctl restart anthropic-proxy',
        'sleep 2',
        'systemctl status anthropic-proxy --no-pager'
    ]
    
    for cmd in commands:
        print(f"Running: {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd)
        out = stdout.read().decode()
        err = stderr.read().decode()
        if out:
            print(out)
        if err and 'Warning' not in err:
            print(f"Error: {err}")
    
    client.close()
    print("\nDone! Service deployed on port 8047")

if __name__ == '__main__':
    deploy()
