import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')
sftp.close()

# Show 80 lines around the [DONE] handler
done_idx = content.find("data === '[DONE]'")
lines = content.split('\n')
# Find the line number
done_line = content[:done_idx].count('\n')
start = max(0, done_line - 40)
end = min(len(lines), done_line + 40)

for i in range(start, end):
    print(f"L{i+1}: {lines[i].rstrip()}")

mac.close()
