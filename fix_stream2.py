import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

sftp = mac.open_sftp()
with sftp.open('/Users/fangjin/llm-gateway/router.js', 'rb') as f:
    content = f.read().decode('utf-8')
sftp.close()

# Find the stream function - search for the [DONE] handling
idx = content.find("data === '[DONE]'")
if idx > 0:
    # Show surrounding context
    start = max(0, idx - 200)
    end = min(len(content), idx + 1000)
    print("Found [DONE] handler at position", idx)
    
    # Find the function start
    func_start = content.rfind('function createOpenAIToAnthropicStream', 0, idx)
    if func_start < 0:
        func_start = content.rfind('createOpenAIToAnthropicStream', 0, idx)
    print(f"Function starts at position {func_start}")
    
    # Show from [DONE] handler area
    lines = content[func_start:end].split('\n')
    for i, line in enumerate(lines):
        print(f"  {line.rstrip()}")
else:
    print("Searching for stream conversion...")
    for i, line in enumerate(content.split('\n'), 1):
        if 'DONE' in line or 'message_stop' in line or 'content_block' in line or 'AnthropicStream' in line:
            print(f"  L{i}: {line.rstrip()}")

mac.close()
