#!/usr/bin/env python3
import paramiko, time, sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    channel = client.get_transport().open_session()
    channel.get_pty()
    channel.settimeout(timeout)
    channel.exec_command(cmd)
    out = b""
    start = time.time()
    while time.time() - start < timeout:
        if channel.recv_ready():
            chunk = channel.recv(4096)
            if not chunk: break
            out += chunk
        elif channel.exit_status_ready():
            while channel.recv_ready():
                out += channel.recv(4096)
            break
        else:
            time.sleep(0.3)
    code = channel.recv_exit_status()
    channel.close()
    text = out.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[^m]*m|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', text)
    return text.strip(), code

# Test Telegram Bot API via VPS proxy
out, code = run("""curl -s --resolve "api.telegram.org:443:138.68.44.141" \
    "https://api.telegram.org/bot8586496186:AAF5ZlW1811IbPKwvMr2FzeTmI7VIjDwTls/sendMessage" \
    -d 'chat_id=6564284621&text=Hook+test+from+Mac+Mini+via+VPS+proxy' \
    --max-time 10 2>&1""", timeout=15)
print(f"[EXIT] {code}")
print(f"[OUT] {out}")

client.close()
