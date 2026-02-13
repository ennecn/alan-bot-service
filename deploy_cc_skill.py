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

# ============================================================
# Step 1: Check existing skills structure
# ============================================================
print("=== Existing skills in Alin config ===")
out, _ = run(f'ls -la {BASE}/deploy/config/skills/')
print(out)

# Check how skills are structured (look at an existing one)
print("\n=== Example skill structure ===")
out, _ = run(f'find {BASE}/deploy/config/skills/ -maxdepth 3 -name "SKILL.md" | head -5')
print(out)
if out:
    first_skill = out.split('\n')[0].strip()
    out2, _ = run(f'head -20 "{first_skill}"')
    print(f"\nFirst 20 lines of {first_skill}:\n{out2}")

mac.close()
print("\n[DONE]")
