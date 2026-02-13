#!/usr/bin/env python3
import paramiko
import sys

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)

if __name__ == '__main__':
    cmd = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else 'docker ps --format "table {{.Names}}\\t{{.Status}}"'
    run_cmd(cmd)
