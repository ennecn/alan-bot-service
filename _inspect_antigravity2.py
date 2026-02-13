#!/usr/bin/env python3
"""Deeper inspection of Antigravity binary and dist folder"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

vps = paramiko.SSHClient()
vps.set_missing_host_key_policy(paramiko.AutoAddPolicy())
vps.connect('138.68.44.141', port=2222, username='root', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = vps.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# 1. Check the binary type
print("=" * 60)
print("1. Binary Type (antigravity-tools)")
print("=" * 60)
out, _ = run('docker exec antigravity-manager head -c 16 /app/antigravity-tools | xxd')
print(out)
out, _ = run('docker exec antigravity-manager ls -lh /app/antigravity-tools')
print(out)

# 2. Explore /app/dist - likely contains web frontend or JS
print("\n" + "=" * 60)
print("2. /app/dist/ Contents (recursively)")
print("=" * 60)
out, _ = run('docker exec antigravity-manager find /app/dist -type f | head -60')
print(out)

# 3. Check if the binary has readable strings about API/tool handling
print("\n" + "=" * 60)
print("3. Strings in binary related to tool_calls / thought_signature")
print("=" * 60)
out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "thought_signature" | head -10')
print(f"thought_signature: {out if out else 'NOT FOUND'}")

out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "tool_calls" | head -10')
print(f"\ntool_calls: {out if out else 'NOT FOUND'}")

out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "tool_choice" | head -10')
print(f"\ntool_choice: {out if out else 'NOT FOUND'}")

out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "function_call" | head -20')
print(f"\nfunction_call related: {out if out else 'NOT FOUND'}")

out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "functionCall" | head -20')
print(f"\nfunctionCall (Gemini native): {out if out else 'NOT FOUND'}")

# 4. Check for OpenAI -> Gemini conversion strings
print("\n" + "=" * 60)
print("4. Conversion-related strings")
print("=" * 60)
out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "openai\\|chat/completions\\|generateContent\\|streamGenerateContent" | sort -u | head -30')
print(out if out else "NOT FOUND")

# 5. Check for Gemini API endpoint patterns
print("\n" + "=" * 60)
print("5. Gemini API patterns in binary")
print("=" * 60)
out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "generativelanguage\\|aiplatform\\|gemini" | sort -u | head -20')
print(out if out else "NOT FOUND")

# 6. Check the config files
print("\n" + "=" * 60)
print("6. Config Files")
print("=" * 60)
out, _ = run('docker exec antigravity-manager cat /root/.antigravity_tools/gui_config.json 2>/dev/null')
print(f"gui_config.json:\n{out[:2000]}")

out, _ = run('docker exec antigravity-manager cat /root/.antigravity_tools/update_settings.json 2>/dev/null')
print(f"\nupdate_settings.json:\n{out[:1000]}")

# 7. Check accounts structure (first account, redacted)
print("\n" + "=" * 60)
print("7. Accounts Structure (keys only)")
print("=" * 60)
out, _ = run("docker exec antigravity-manager python3 -c \"import json; data=json.load(open('/root/.antigravity_tools/accounts.json')); print('Account count:', len(data) if isinstance(data,list) else 'dict'); a=data[0] if isinstance(data,list) else list(data.values())[0]; print('Keys:', list(a.keys()) if isinstance(a,dict) else type(a))\" 2>/dev/null")
print(out)

# 8. Check if there's any proxy/middleware code we can modify
print("\n" + "=" * 60)
print("8. Any modifiable files on host (mounted)")
print("=" * 60)
out, _ = run('ls -la /root/.antigravity_tools/')
print(out)

# 9. Docker image layers - see what was added
print("\n" + "=" * 60)
print("9. Docker Image History")
print("=" * 60)
out, _ = run('docker history lbjlaq/antigravity-manager:v4.1.12 --no-trunc 2>/dev/null | head -20')
print(out[:2000])

# 10. Check latest available version
print("\n" + "=" * 60)
print("10. Version Info")
print("=" * 60)
out, _ = run('docker exec antigravity-manager /app/antigravity-tools --version 2>&1 || echo "No --version flag"')
print(f"Version: {out}")
out, _ = run('docker exec antigravity-manager strings /app/antigravity-tools | grep -i "v4\\." | head -5')
print(f"Version strings: {out}")

vps.close()
print("\n[DONE]")
