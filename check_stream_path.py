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
# Show the streaming handler area (lines 470-530)
for i in range(469, min(540, len(lines))):
    print(f"L{i+1}: {lines[i].rstrip()}")

# Also search for where createOpenAIToAnthropicStream is called
print("\n=== Where createOpenAIToAnthropicStream is called ===")
for i, line in enumerate(lines, 1):
    if 'createOpenAIToAnthropicStream' in line or 'Streaming OpenAI' in line:
        print(f"L{i}: {line.rstrip()}")

mac.close()
