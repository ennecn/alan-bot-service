import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=60):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

BASE = '/Users/fangjin/Desktop/p/docker-openclawd'

# Check deploy dirs and their compose files
dirs = ['deploy', 'deploy-aling', 'deploy-lain', 'deploy-lumi']
for d in dirs:
    print(f"\n=== {d} ===")
    out, _ = run(f'ls {BASE}/{d}/')
    print(f"Files: {out}")
    # Check compose
    out, _ = run(f'cat {BASE}/{d}/docker-compose.yml 2>/dev/null | head -30')
    if not out:
        out, _ = run(f'cat {BASE}/{d}/docker-compose.yaml 2>/dev/null | head -30')
    print(f"Compose:\n{out[:500]}")
    # Check .env
    out, _ = run(f'head -5 {BASE}/{d}/.env 2>/dev/null')
    print(f"Env: {out}")

mac.close()
print("\n[DONE]")
