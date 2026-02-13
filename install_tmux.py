#!/usr/bin/env python3
import paramiko, time, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

channel = client.get_transport().open_session()
channel.get_pty()
channel.exec_command('export HOMEBREW_NO_AUTO_UPDATE=1 PATH=/opt/homebrew/bin:$PATH && brew install tmux 2>&1 && tmux -V')

start = time.time()
while time.time() - start < 120:
    if channel.recv_ready():
        chunk = channel.recv(4096)
        try:
            print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
        except:
            pass
    elif channel.exit_status_ready():
        while channel.recv_ready():
            try:
                print(channel.recv(4096).decode('utf-8', errors='replace'), end='', flush=True)
            except:
                pass
        break
    else:
        time.sleep(0.5)

print(f"\n[EXIT] {channel.recv_exit_status()}")
channel.close()
client.close()
