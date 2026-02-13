#!/usr/bin/env python3
"""Integrate Kimi Coding API into LLM Gateway V2."""
import paramiko
import json

GW_DIR = '/Users/fangjin/llm-gateway-v2'

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = c.open_sftp()

    # ── Step 1: Update config.json ──
    print("=== Updating config.json ===")
    with sftp.open(f'{GW_DIR}/config.json', 'r') as f:
        config = json.loads(f.read().decode())

    # Add kimi provider
    config['providers']['kimi'] = {
        "baseUrl": "https://api.kimi.com/coding",
        "apiKey": "sk-kimi-526KDees9K4QdlMeacjrZE9wyzPXi1QQ4NqYPJ1gHW8hbqVjZoBwU8sTmbEVjZHs",
        "api": "anthropic",
        "modelMap": {
            "claude-opus-4-6": "kimi-for-coding",
            "claude-opus-4-6-20250514": "kimi-for-coding",
            "claude-sonnet-4-5-20250514": "kimi-for-coding"
        },
        "headers": {
            "User-Agent": "claude-code/2.1.39"
        }
    }

    # Add model option
    kimi_option = {"id": "kimi/kimi-for-coding", "label": "Kimi For Coding"}
    existing_ids = [o['id'] for o in config.get('modelOptions', [])]
    if kimi_option['id'] not in existing_ids:
        config['modelOptions'].append(kimi_option)

    with sftp.open(f'{GW_DIR}/config.json', 'wb') as f:
        f.write(json.dumps(config, indent=2, ensure_ascii=False).encode('utf-8'))
    print("  config.json updated: kimi provider + model option added")

    # ── Step 2: Update server.js ──
    print("=== Updating server.js ===")
    with sftp.open(f'{GW_DIR}/server.js', 'r') as f:
        server_js = f.read().decode()

    # Patch 1: OpenAI path - add custom headers after Authorization header
    old_openai = """        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'Authorization': `Bearer ${provider.apiKey}`,
        },
      };"""
    new_openai = """        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'Authorization': `Bearer ${provider.apiKey}`,
          ...(provider.headers || {}),
        },
      };"""

    if old_openai in server_js:
        server_js = server_js.replace(old_openai, new_openai)
        print("  Patched OpenAI path: custom headers support added")
    elif '...(provider.headers' in server_js and 'Bearer' in server_js:
        print("  OpenAI path: already patched")
    else:
        print("  WARNING: OpenAI path pattern not found!")

    # Patch 2: Anthropic path - add custom headers after anthropic-version header
    old_anthropic = """        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'x-api-key': provider.apiKey,
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        },
      };"""
    new_anthropic = """        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'x-api-key': provider.apiKey,
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
          ...(provider.headers || {}),
        },
      };"""

    if old_anthropic in server_js:
        server_js = server_js.replace(old_anthropic, new_anthropic)
        print("  Patched Anthropic path: custom headers support added")
    elif '...(provider.headers' in server_js and 'x-api-key' in server_js:
        print("  Anthropic path: already patched")
    else:
        print("  WARNING: Anthropic path pattern not found!")

    with sftp.open(f'{GW_DIR}/server.js', 'wb') as f:
        f.write(server_js.encode('utf-8'))
    print("  server.js saved")

    # ── Step 3: Restart LLM Gateway ──
    print("=== Restarting LLM Gateway ===")
    _, o, e = c.exec_command('launchctl stop com.llm-gateway; sleep 3; launchctl start com.llm-gateway')
    o.read()
    import time
    time.sleep(5)

    # Verify gateway is running
    _, o, e = c.exec_command('curl -s http://127.0.0.1:8080/api/status')
    status = o.read().decode()
    if 'kimi' in status.lower() or 'uptime' in status:
        print(f"  Gateway restarted OK")
    else:
        print(f"  WARNING: Gateway status: {status[:200]}")

    # ── Step 4: Verify config ──
    print("=== Verifying config ===")
    _, o, e = c.exec_command('curl -s http://127.0.0.1:8080/api/status')
    try:
        st = json.loads(o.read().decode())
        options = [o['id'] for o in st.get('modelOptions', [])]
        print(f"  Model options: {options}")
        if 'kimi/kimi-for-coding' in options:
            print("  Kimi model option present!")
        else:
            print("  WARNING: Kimi model option missing!")
    except Exception as ex:
        print(f"  Error: {ex}")

    sftp.close()
    c.close()
    print("\nDone! Kimi provider added. Switch bots via Gateway dashboard.")

if __name__ == '__main__':
    main()
