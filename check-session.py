import json
with open('/Users/fangjin/.claude/projects/-Users-fangjin-telegram-claude-bot-workspace/3db90191-6eb6-48d2-942d-e0aa24acd340.jsonl') as f:
    for i, line in enumerate(f):
        d = json.loads(line)
        t = d.get('type','?')
        role = d.get('message',{}).get('role','')
        content = d.get('message',{}).get('content','')
        if isinstance(content, list):
            texts = [b.get('text','')[:60] for b in content if b.get('type')=='text']
            content = ' | '.join(texts)
        else:
            content = str(content)[:80]
        print(f"[{i}] {t} | {role} | {content}")
