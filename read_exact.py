import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

stdin, stdout, stderr = mac.exec_command('cat /Users/fangjin/llm-gateway/router.js')
content = stdout.read().decode('utf-8', errors='replace')

lines = content.split('\n')
# Show lines 400-415 with repr to see exact whitespace
for i in range(399, min(415, len(lines))):
    print(f"L{i+1}: {repr(lines[i])}")

mac.close()
