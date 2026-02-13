import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')
sftp.close()

lines = content.split('\n')
total = len(lines)
print(f"Total lines: {total}")

# Show last 100 lines where createOpenAIToAnthropicStream should be
for i in range(max(0, total - 100), total):
    print(f"L{i+1}: {lines[i].rstrip()}")

mac.close()
