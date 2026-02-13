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

# Step 1: Check full compose file to understand volume mounts for skills
print("=== Full compose for deploy (Alin) ===")
out, _ = run(f'cat {BASE}/deploy/docker-compose.yml')
print(out)

# Check config dir to understand skill loading
print("\n=== Config dir ===")
out, _ = run(f'ls -la {BASE}/deploy/config/')
print(out)

# Check if there's a skills dir in config
print("\n=== Skills in config ===")
out, _ = run(f'find {BASE}/deploy/config/ -name "*.skill*" -o -name "skills" -type d 2>/dev/null')
print(out or "None found")

# Check the existing skill file at the top level
print("\n=== Existing skill file ===")
out, _ = run(f'cat {BASE}/openclaw-tool-prefix-patch.skill | head -10')
print(out)

mac.close()
print("\n[DONE]")
