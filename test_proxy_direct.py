#!/usr/bin/env python3
"""Direct test of api-proxy inside container."""
import paramiko
import json

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    container = 'deploy-openclaw-gateway-1'

    # Write test script inside container
    script = '''#!/bin/bash
curl -s -X POST http://127.0.0.1:8022/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-opus-4-6","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}'
'''
    write_cmd = f"docker exec -i {container} tee /tmp/test-proxy.sh > /dev/null"
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
    stdin.write(script)
    stdin.channel.shutdown_write()
    stdout.read()

    # Make it executable and run
    run_cmd = f'docker exec {container} bash /tmp/test-proxy.sh'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{run_cmd}"', timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f'Proxy response: {out[:500]}')
    if err:
        print(f'Stderr: {err[:200]}')

    # Check Gateway log
    log_cmd = 'tail -3 /private/tmp/gateway-v2.log'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{log_cmd}"')
    out = stdout.read().decode()
    print(f'\nGateway log:\n{out}')

    # Check proxy stdout in docker logs
    log_cmd2 = f'docker logs {container} 2>&1 | tail -5'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{log_cmd2}"')
    out = stdout.read().decode()
    print(f'\nContainer logs:\n{out}')

    client.close()

if __name__ == '__main__':
    run()
