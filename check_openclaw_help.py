#!/usr/bin/env python3
import paramiko, time, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

channel = client.get_transport().open_session()
channel.get_pty()
channel.exec_command('export PATH=/opt/homebrew/bin:$PATH && openclaw --help 2>&1; echo "===MSG==="; openclaw message --help 2>&1; echo "===SEND==="; openclaw message send --help 2>&1')

out = b""
start = time.time()
while time.time() - start < 15:
    if channel.recv_ready():
        out += channel.recv(4096)
    elif channel.exit_status_ready():
        while channel.recv_ready():
            out += channel.recv(4096)
        break
    else:
        time.sleep(0.3)

import re
text = out.decode('utf-8', errors='replace')
text = re.sub(r'\x1b\[[^m]*m|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', text)
print(text)

channel.close()
client.close()
