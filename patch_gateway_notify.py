#!/usr/bin/env python3
"""Patch LLM Gateway server.js to send Telegram notifications on model/provider switch."""
import paramiko

def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    server_path = '/Users/fangjin/llm-gateway-v2/server.js'

    # Read current server.js
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "cat {server_path}"')
    code = stdout.read().decode()

    # Patch 1: Add Telegram notification after provider switch
    old_provider = '''    config.bots[botId].provider = providerName;
    saveConfig();
    log(`[Config] ${botCfg.name} proxy provider → ${providerName}`);
    sendJson(res, 200, { success: true, bot: botCfg.name, provider: providerName });'''

    new_provider = '''    config.bots[botId].provider = providerName;
    saveConfig();
    log(`[Config] ${botCfg.name} proxy provider → ${providerName}`);
    // Build status summary of all bots
    const statusLines = Object.entries(config.bots).map(([id, b]) => `  ${b.name}: ${b.provider || 'default'}`).join('\\n');
    sendTelegram(`🔄 ${botCfg.name} provider → ${providerName}\\n\\nCurrent routing:\\n${statusLines}`);
    sendJson(res, 200, { success: true, bot: botCfg.name, provider: providerName });'''

    if old_provider in code:
        code = code.replace(old_provider, new_provider)
        print('Patched: provider switch notification')
    else:
        print('WARNING: Could not find provider switch code to patch')

    # Patch 2: Add Telegram notification after model switch
    old_model = '''      log(`[Config] ${botCfg.name} → ${modelId} (OpenClaw will hot-reload)`);
      sendJson(res, 200, { success: true, bot: botCfg.name, model: modelId, provider: config.bots[botId].provider });'''

    new_model = '''      log(`[Config] ${botCfg.name} → ${modelId} (OpenClaw will hot-reload)`);
      const allStatus = Object.entries(config.bots).map(([id, b]) => `  ${b.name}: ${b.provider || 'default'}`).join('\\n');
      sendTelegram(`🔄 ${botCfg.name} model → ${modelId}\\nprovider: ${config.bots[botId].provider}\\n\\nCurrent routing:\\n${allStatus}`);
      sendJson(res, 200, { success: true, bot: botCfg.name, model: modelId, provider: config.bots[botId].provider });'''

    if old_model in code:
        code = code.replace(old_model, new_model)
        print('Patched: model switch notification')
    else:
        print('WARNING: Could not find model switch code to patch')

    # Write back
    write_cmd = f"tee {server_path} > /dev/null"
    stdin, stdout, stderr = client.exec_command(f'bash -l -c "{write_cmd}"')
    stdin.write(code)
    stdin.channel.shutdown_write()
    stdout.read()
    err = stderr.read().decode()
    if err:
        print(f'Write error: {err}')
    else:
        print('server.js updated')

    # Restart Gateway
    print('Restarting Gateway...')
    stdin, stdout, stderr = client.exec_command('bash -l -c "launchctl stop com.llm-gateway; sleep 3; launchctl start com.llm-gateway"')
    stdout.read()
    print('Gateway restarted')

    # Verify
    import time
    time.sleep(3)
    stdin, stdout, stderr = client.exec_command('bash -l -c "curl -s http://127.0.0.1:8080/health 2>/dev/null"')
    out = stdout.read().decode()
    print(f'Health: {out}')

    client.close()

if __name__ == '__main__':
    run()
