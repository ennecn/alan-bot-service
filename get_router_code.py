#!/usr/bin/env python3
"""获取 router.js 的精确代码段，用于补丁匹配"""
import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def run_cmd_mac(cmd, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

# 获取关键代码段（用行号）
segments = [
    ("通知逻辑 (循环开头)", "365,380"),
    ("Anthropic streaming 成功", "472,500"),
    ("OpenAI streaming 成功", "498,530"),
    ("server error cascade", "618,635"),
    ("非 streaming 成功", "648,680"),
]

for name, lines in segments:
    print(f"\n{'='*60}")
    print(f"[{name}] 行 {lines}")
    print('='*60)
    out, _ = run_cmd_mac(f'sed -n "{lines}p" /Users/fangjin/llm-gateway/router.js')
    # 打印每行，保留原始缩进（用 repr 显示空格/tab）
    for i, line in enumerate(out.split('\n')):
        line_num = int(lines.split(',')[0]) + i
        # 显示前导空格的数量
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        print(f"  {line_num:4d} |{line}")
