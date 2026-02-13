import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

cmd = sys.argv[1] if len(sys.argv) > 1 else 'echo hello'
full_cmd = f'export PATH=/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin; {cmd}'
stdin, stdout, stderr = ssh.exec_command(full_cmd)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(out.encode('utf-8', errors='replace'))
sys.stderr.buffer.write(err.encode('utf-8', errors='replace'))
ssh.close()
