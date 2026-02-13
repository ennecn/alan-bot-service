import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=120):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH'

# Run Claude Code directly, capture ALL output
print("=== Raw Claude Code stream-json output ===")
result = run(
    f'{PATH_PREFIX} && cd /Users/fangjin/llm-gateway && '
    f'ANTHROPIC_API_KEY="gw-alin-86f31cca5b0d93189ffca6887138ff41" '
    f'ANTHROPIC_BASE_URL="http://127.0.0.1:8080" '
    f'claude -p "What files are in this directory? Just list the filenames." '
    f'--output-format stream-json --verbose --dangerously-skip-permissions '
    f'--max-budget-usd 0.1 2>/dev/null',
    timeout=90
)

print(f"Output length: {len(result)} chars")
print("\nRaw output:")
for line in result.split('\n'):
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
        t = d.get('type', '???')
        
        if t == 'system':
            print(f"  [{t}] subtype={d.get('subtype')}")
        elif t == 'assistant':
            msg = d.get('message', {})
            for block in msg.get('content', []):
                bt = block.get('type', '')
                if bt == 'text':
                    print(f"  [{t}] TEXT: {block.get('text', '')[:500]}")
                elif bt == 'tool_use':
                    print(f"  [{t}] TOOL: {block.get('name')} input={str(block.get('input', ''))[:200]}")
                else:
                    print(f"  [{t}] {bt}: {str(block)[:200]}")
            if not msg.get('content'):
                print(f"  [{t}] (no content)")
        elif t == 'tool':
            msg = d.get('message', {})
            content = msg.get('content', '')
            if isinstance(content, list):
                for b in content:
                    print(f"  [{t}] result: {str(b.get('content', ''))[:300]}")
            else:
                print(f"  [{t}] {str(content)[:300]}")
        elif t == 'result':
            print(f"  [{t}] turns={d.get('num_turns')}, cost=${d.get('total_cost_usd')}, "
                  f"duration={d.get('duration_ms')}ms, error={d.get('is_error')}")
            print(f"  [{t}] result text: '{d.get('result', '')[:500]}'")
            print(f"  [{t}] errors: {d.get('errors', [])}")
            usage = d.get('usage', {})
            print(f"  [{t}] tokens: in={usage.get('input_tokens')}, out={usage.get('output_tokens')}")
            model_usage = d.get('modelUsage', {})
            for model_name, mu in model_usage.items():
                print(f"  [{t}] {model_name}: in={mu.get('inputTokens')}, out={mu.get('outputTokens')}")
        else:
            print(f"  [{t}] {str(d)[:200]}")
    except:
        print(f"  [RAW] {line[:200]}")

mac.close()
print("\n[DONE]")
