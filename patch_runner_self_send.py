#!/usr/bin/env python3
"""Patch claude-code-dispatch.sh runner to send results via bot's own Telegram token.

Instead of using @Claudebigboss_bot (relay bot), the runner will:
1. Read bot-tokens.json to find the bot's own token
2. Send results as the bot itself (appears in same chat thread)
3. Still inject into session via chat.inject for context
"""
import paramiko
import json
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'

BOT_TOKENS = {
    "alin": "8586496186:AAF5ZlW1811IbPKwvMr2FzeTmI7VIjDwTls",
    "aling": "8586252932:AAGsOoUDM3BYa0eRuAWyvNvAtxhJkYzh9p8",
    "lain": "8276930756:AAH12Tpv6ms8rhnCSYxjmdjwblJd5OS1JeM",
    "lumi": "8500283681:AAHyo9qY5Oll9ARicE53qcl2lqsiNuLwDsE",
}

def ssh_exec(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    rc = stdout.channel.recv_exit_status()
    return out, err, rc

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS)

    # Step 1: Write bot-tokens.json
    print("[1] Writing bot-tokens.json...")
    tokens_json = json.dumps(BOT_TOKENS, indent=2)
    ssh_exec(client, f"cat > /Users/fangjin/bot-tokens.json << 'TOKEOF'\n{tokens_json}\nTOKEOF")
    out, _, _ = ssh_exec(client, "cat /Users/fangjin/bot-tokens.json")
    print(f"    Written: {out.strip()}")

    # Step 2: Read current dispatch script
    print("[2] Reading current dispatch script...")
    out, _, _ = ssh_exec(client, "cat /Users/fangjin/claude-code-dispatch.sh")
    dispatch = out

    # Step 3: Patch the runner section
    # Replace the relay bot config block with self-send logic
    old_relay_block = '''# Relay bot config (@Claudebigboss_bot)
TG_PROXY_IP="138.68.44.141"
RELAY_BOT_TOKEN="7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"
RELAY_GROUP_ID="-1003849405283"
RELAY_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"'''

    new_relay_block = '''# Bot's own token (send as the bot itself, not relay)
TG_PROXY_IP="138.68.44.141"
RELAY_GROUP_ID="-1003849405283"
TOKENS_FILE="/Users/fangjin/bot-tokens.json"
RELAY_BOT_TOKEN="7589272367:AAGYC28tn02qps-usiTiBnI0E-PktyxSrVs"

# Try to use bot's own token; fall back to relay bot
BOT_TOKEN=""
if [ -f "$TOKENS_FILE" ]; then
    BOT_TOKEN=$($JQ -r ".${BOT_DIR} // empty" "$TOKENS_FILE" 2>/dev/null)
fi
if [ -n "$BOT_TOKEN" ]; then
    SEND_API="https://api.telegram.org/bot${BOT_TOKEN}"
    SEND_LABEL="self"
    log "[relay] Using bot's own token for $BOT_NAME"
else
    SEND_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"
    SEND_LABEL="relay"
    log "[relay] No own token found, using relay bot"
fi
# Relay API always uses relay bot (for group backup)
RELAY_API="https://api.telegram.org/bot${RELAY_BOT_TOKEN}"'''

    if old_relay_block not in dispatch:
        print("    ERROR: Could not find relay block to patch!")
        print("    Looking for the block...")
        # Try to find it with different whitespace
        for line in old_relay_block.split('\n'):
            if line.strip() and line.strip() not in dispatch:
                print(f"    Missing line: {repr(line)}")
        client.close()
        sys.exit(1)

    dispatch = dispatch.replace(old_relay_block, new_relay_block)

    # Now patch send_tg to use SEND_API for user DM, RELAY_API for group
    old_send_tg = '''send_tg() {
    local CHAT_ID="$1"
    local TEXT="$2"
    local LABEL="$3"
    local RESP
    for attempt in 1 2; do
        RESP=$(curl -s \\
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\
            "${RELAY_API}/sendMessage" \\
            --data-urlencode "chat_id=${CHAT_ID}" \\
            --data-urlencode "text=${TEXT}" \\
            --max-time 15 2>&1)
        if echo "$RESP" | grep -q '"ok":true'; then
            log "[relay] $LABEL: sent (attempt $attempt)"
            return 0
        fi
        log "[relay] $LABEL attempt $attempt failed: $RESP"
        sleep 2
    done
    return 1
}'''

    new_send_tg = '''send_tg() {
    local CHAT_ID="$1"
    local TEXT="$2"
    local LABEL="$3"
    local API_URL="$4"  # which API to use
    [ -z "$API_URL" ] && API_URL="$SEND_API"
    local RESP
    for attempt in 1 2; do
        RESP=$(curl -s \\
            --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\
            "${API_URL}/sendMessage" \\
            --data-urlencode "chat_id=${CHAT_ID}" \\
            --data-urlencode "text=${TEXT}" \\
            --max-time 15 2>&1)
        if echo "$RESP" | grep -q '"ok":true'; then
            log "[$SEND_LABEL] $LABEL: sent (attempt $attempt)"
            return 0
        fi
        log "[$SEND_LABEL] $LABEL attempt $attempt failed: $RESP"
        sleep 2
    done
    return 1
}'''

    if old_send_tg not in dispatch:
        print("    ERROR: Could not find send_tg function to patch!")
        client.close()
        sys.exit(1)

    dispatch = dispatch.replace(old_send_tg, new_send_tg)

    # Patch send_tg_doc similarly
    old_send_doc = '''send_tg_doc() {
    local CHAT_ID="$1"
    local FILE="$2"
    local CAPTION="$3"
    local LABEL="$4"
    local RESP
    RESP=$(curl -s \\
        --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\
        "${RELAY_API}/sendDocument" \\
        -F "chat_id=${CHAT_ID}" \\
        -F "caption=${CAPTION}" \\
        -F "document=@${FILE};filename=${TASK_NAME}-result.txt" \\
        --max-time 30 2>&1)
    if echo "$RESP" | grep -q '"ok":true'; then
        log "[relay] $LABEL: document sent"
        return 0
    fi
    log "[relay] $LABEL: document failed: $RESP"
    return 1
}'''

    new_send_doc = '''send_tg_doc() {
    local CHAT_ID="$1"
    local FILE="$2"
    local CAPTION="$3"
    local LABEL="$4"
    local API_URL="$5"
    [ -z "$API_URL" ] && API_URL="$SEND_API"
    local RESP
    RESP=$(curl -s \\
        --resolve "api.telegram.org:443:${TG_PROXY_IP}" \\
        "${API_URL}/sendDocument" \\
        -F "chat_id=${CHAT_ID}" \\
        -F "caption=${CAPTION}" \\
        -F "document=@${FILE};filename=${TASK_NAME}-result.txt" \\
        --max-time 30 2>&1)
    if echo "$RESP" | grep -q '"ok":true'; then
        log "[$SEND_LABEL] $LABEL: document sent"
        return 0
    fi
    log "[$SEND_LABEL] $LABEL: document failed: $RESP"
    return 1
}'''

    if old_send_doc not in dispatch:
        print("    ERROR: Could not find send_tg_doc function to patch!")
        client.close()
        sys.exit(1)

    dispatch = dispatch.replace(old_send_doc, new_send_doc)

    # Patch notification section: user DM uses SEND_API (bot's own), group uses RELAY_API
    # For short messages
    old_dm_send = '''        # Send to user DM (primary)
        if [ -n "$TELEGRAM_GROUP" ]; then
            DM_MSG="[$BOT_NAME] ${TASK_NAME}
${CLEAN_RESULT}"
            send_tg "$TELEGRAM_GROUP" "$DM_MSG" "user-dm"
        fi
        # Send to group (backup)
        GROUP_MSG="[$BOT_NAME] ${TASK_NAME}
${CLEAN_RESULT}"
        send_tg "$RELAY_GROUP_ID" "$GROUP_MSG" "group"'''

    new_dm_send = '''        # Send to user DM via bot's own token (appears in same chat)
        if [ -n "$TELEGRAM_GROUP" ]; then
            DM_MSG="[CC] ${TASK_NAME}
${CLEAN_RESULT}"
            send_tg "$TELEGRAM_GROUP" "$DM_MSG" "user-dm" "$SEND_API"
        fi
        # Send to group via relay bot (backup)
        GROUP_MSG="[$BOT_NAME] ${TASK_NAME}
${CLEAN_RESULT}"
        send_tg "$RELAY_GROUP_ID" "$GROUP_MSG" "group" "$RELAY_API"'''

    if old_dm_send not in dispatch:
        print("    ERROR: Could not find DM send block to patch!")
        client.close()
        sys.exit(1)

    dispatch = dispatch.replace(old_dm_send, new_dm_send)

    # For long messages (document)
    old_doc_send = '''        # Send to user DM (primary)
        if [ -n "$TELEGRAM_GROUP" ]; then
            send_tg_doc "$TELEGRAM_GROUP" "$RELAY_FILE" "$CAPTION" "user-dm"
        fi
        # Send to group (backup)
        send_tg_doc "$RELAY_GROUP_ID" "$RELAY_FILE" "$CAPTION" "group"'''

    new_doc_send = '''        # Send to user DM via bot's own token
        if [ -n "$TELEGRAM_GROUP" ]; then
            send_tg_doc "$TELEGRAM_GROUP" "$RELAY_FILE" "$CAPTION" "user-dm" "$SEND_API"
        fi
        # Send to group via relay bot (backup)
        send_tg_doc "$RELAY_GROUP_ID" "$RELAY_FILE" "$CAPTION" "group" "$RELAY_API"'''

    if old_doc_send not in dispatch:
        print("    ERROR: Could not find doc send block to patch!")
        client.close()
        sys.exit(1)

    dispatch = dispatch.replace(old_doc_send, new_doc_send)

    # Update version
    dispatch = dispatch.replace(
        '# claude-code-dispatch.sh v2.1',
        '# claude-code-dispatch.sh v2.2'
    )
    dispatch = dispatch.replace(
        '# Task runner v3.4',
        '# Task runner v3.5 - self-send via bot token'
    )

    # Step 4: Write patched script
    print("[3] Writing patched dispatch script...")
    # Use SFTP to write the file (avoids shell escaping issues)
    sftp = client.open_sftp()
    with sftp.open('/Users/fangjin/claude-code-dispatch.sh', 'w') as f:
        f.write(dispatch)
    sftp.close()

    # Make executable
    ssh_exec(client, "chmod +x /Users/fangjin/claude-code-dispatch.sh")

    # Verify
    out, _, _ = ssh_exec(client, "head -3 /Users/fangjin/claude-code-dispatch.sh")
    print(f"    Header: {out.strip()}")

    out, _, _ = ssh_exec(client, "grep -c 'SEND_API\\|BOT_TOKEN\\|send_tg.*SEND_API\\|send_tg_doc.*SEND_API' /Users/fangjin/claude-code-dispatch.sh")
    print(f"    Patch markers found: {out.strip()} occurrences")

    out, _, _ = ssh_exec(client, "grep 'runner v3' /Users/fangjin/claude-code-dispatch.sh")
    print(f"    Runner version: {out.strip()}")

    print("\n[4] Done! Next task dispatched by any bot will send results as the bot itself.")
    print("    - User DM: sent via bot's own token (appears in same chat)")
    print("    - Group backup: still sent via relay bot")
    print("    - chat.inject: unchanged (still injects into session)")

    client.close()

if __name__ == '__main__':
    main()
