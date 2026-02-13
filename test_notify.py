#!/usr/bin/env python3
"""Test Gateway notification by switching alin provider and back."""
import paramiko
import json
import time

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    # Write test script on Mac Mini
    script = '''#!/bin/bash
# Switch alin to antigravity
curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"antigravity"}'
echo ""
sleep 3
# Switch back to kimi
curl -s -X PUT http://127.0.0.1:8080/api/bots/alin/provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"kimi"}'
echo ""
'''
    write_cmd = 'tee /tmp/test-notify.sh > /dev/null'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
    stdin.write(script)
    stdin.channel.shutdown_write()
    stdout.read()

    # Run it
    stdin, stdout, stderr = client.exec_command('bash -l -c "bash /tmp/test-notify.sh"', timeout=20)
    out = stdout.read().decode()
    print(f'Results:\n{out}')

    time.sleep(2)
    stdin, stdout, stderr = client.exec_command('bash -l -c "tail -8 /private/tmp/gateway-v2.log"')
    out = stdout.read().decode()
    print(f'Gateway log:\n{out}')

    client.close()

if __name__ == '__main__':
    run()
