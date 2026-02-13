import paramiko, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=30):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# All containers
print("=== All Docker containers ===")
out, _ = run('docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"')
print(out)

# Check deploy dirs
print("\n=== Deploy directories ===")
out, _ = run('ls -la /Users/fangjin/Desktop/p/docker-openclawd/')
print(out)

# Find actual skill locations in running containers
print("\n=== Find skills in running containers ===")
out, _ = run('docker ps --format "{{.Names}}"')
for name in out.split('\n'):
    name = name.strip()
    if not name:
        continue
    skills_out, _ = run(f'docker exec {name} find / -name "*.skill.md" -o -name "skills" -type d 2>/dev/null | head -20')
    if skills_out:
        print(f"  {name}: {skills_out}")
    else:
        print(f"  {name}: no skills found")

mac.close()
print("\n[DONE]")
