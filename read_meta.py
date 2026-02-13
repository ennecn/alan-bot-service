#!/usr/bin/env python3
import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
stdin, stdout, stderr = client.exec_command('cat ~/Desktop/p/docker-openclawd/deploy/config/skills/claude-code/_meta.json 2>/dev/null')
print(stdout.read().decode())
client.close()
