#!/usr/bin/env python3
"""Test Gateway connectivity from inside 阿凛's container."""
import paramiko
import json

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    container = 'deploy-openclaw-gateway-1'

    # Test 1: Can container reach Gateway?
    cmd1 = f'docker exec {container} curl -s -o /dev/null -w "%{{http_code}}" http://host.docker.internal:8080/api/config'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{cmd1}"')
    code = stdout.read().decode().strip()
    print(f'Gateway reachable: HTTP {code}')

    # Test 2: Send a test API request through the proxy
    test_body = json.dumps({
        "model": "claude-opus-4-6",
        "max_tokens": 10,
        "messages": [{"role": "user", "content": "say hi"}]
    })

    # Write test body to a temp file in container
    write_cmd = f"docker exec -i {container} tee /tmp/test-req.json > /dev/null"
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
    stdin.write(test_body)
    stdin.channel.shutdown_write()
    stdout.read()

    # Send request through local proxy
    proxy_cmd = f'docker exec {container} curl -s -w "\\nHTTP_CODE:%{{http_code}}" http://127.0.0.1:8022/v1/messages -H "Content-Type: application/json" -H "anthropic-version: 2023-06-01" -d @/tmp/test-req.json'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{proxy_cmd}"', timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f'Proxy response:\n{out[:500]}')
    if err:
        print(f'Stderr: {err[:200]}')

    # Test 3: Check Gateway log for new entries
    log_cmd = 'tail -5 /private/tmp/gateway-v2.log'
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{log_cmd}"')
    out = stdout.read().decode()
    print(f'\nGateway log (last 5 lines):\n{out}')

    client.close()

if __name__ == '__main__':
    run()
