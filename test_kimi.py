#!/usr/bin/env python3
"""Switch a bot's provider and test Kimi routing."""
import paramiko
import json
import time

GW_DIR = '/Users/fangjin/llm-gateway-v2'

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = c.open_sftp()

    # Switch alin to kimi
    with sftp.open(f'{GW_DIR}/config.json', 'r') as f:
        config = json.loads(f.read().decode())

    old_provider = config['bots']['alin']['provider']
    config['bots']['alin']['provider'] = 'kimi'

    with sftp.open(f'{GW_DIR}/config.json', 'wb') as f:
        f.write(json.dumps(config, indent=2, ensure_ascii=False).encode('utf-8'))
    print(f"Switched alin: {old_provider} -> kimi")

    # Restart gateway
    _, o, e = c.exec_command('launchctl stop com.llm-gateway; sleep 3; launchctl start com.llm-gateway')
    o.read()
    time.sleep(5)

    # Test: send request as alin
    print("\n=== Testing Kimi via Gateway (as alin) ===")
    test_cmd = """curl -s -X POST http://127.0.0.1:8080/v1/messages \
      -H 'Content-Type: application/json' \
      -H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' \
      -H 'anthropic-version: 2023-06-01' \
      -d '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"Say hello in one word"}],"max_tokens":20}'"""
    _, o, e = c.exec_command(test_cmd)
    result = o.read().decode('utf-8', errors='replace')
    print(f"Response: {result}")

    # Check if it worked
    if '"type":"message"' in result and 'content' in result:
        print("\nKimi routing works!")
    elif 'error' in result:
        print(f"\nError detected. Checking gateway log...")
        _, o, e = c.exec_command('tail -5 /private/tmp/gateway-v2.log')
        print(o.read().decode('utf-8', errors='replace'))

    # Test with tool_use
    print("\n=== Testing tool_use via Kimi ===")
    tool_cmd = """curl -s -X POST http://127.0.0.1:8080/v1/messages \
      -H 'Content-Type: application/json' \
      -H 'x-api-key: gw-alin-86f31cca5b0d93189ffca6887138ff41' \
      -H 'anthropic-version: 2023-06-01' \
      -d '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"What is the weather in Tokyo?"}],"tools":[{"name":"get_weather","description":"Get weather","input_schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}],"max_tokens":200}'"""
    _, o, e = c.exec_command(tool_cmd)
    result = o.read().decode('utf-8', errors='replace')
    print(f"Tool use response: {result[:500]}")

    if '"tool_use"' in result:
        print("\nTool use works!")
    else:
        print("\nTool use may have issues")

    sftp.close()
    c.close()

if __name__ == '__main__':
    main()
