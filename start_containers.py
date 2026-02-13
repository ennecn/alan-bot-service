import paramiko, json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd, timeout=60):
    # Prepend PATH to include docker
    full_cmd = f'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" && {cmd}'
    stdin, stdout, stderr = mac.exec_command(full_cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Find docker
print("=== Find docker ===")
out, _ = run('which docker || find /usr/local/bin /opt/homebrew/bin /Applications -name "docker" -type f 2>/dev/null | head -5')
print(out)

BASE = '/Users/fangjin/Desktop/p/docker-openclawd'
deploys = ['deploy', 'deploy-aling', 'deploy-lain', 'deploy-lumi']

# Start containers
for d in deploys:
    print(f"\n=== Starting {d} ===")
    out, err = run(f'cd {BASE}/{d} && docker compose up -d 2>&1', timeout=120)
    print(out[:300])
    if err:
        print(f"ERR: {err[:300]}")

time.sleep(10)

# Verify
print("\n=== Running containers ===")
out, _ = run('docker ps --format "table {{.Names}}\\t{{.Status}}"')
print(out)

# Test bridge from Alin container
print("\n=== Bridge test from container ===")
out, _ = run('docker ps --format "{{.Names}}" | head -1')
first_container = out.strip()
print(f"Testing from: {first_container}")
if first_container:
    out, _ = run(f'docker exec {first_container} curl -s http://host.docker.internal:9090/health --max-time 5')
    print(f"Bridge health: {out}")
    
    # Verify skill file
    out, _ = run(f'docker exec {first_container} head -5 /home/node/.openclaw/skills/cc-bridge/SKILL.md')
    print(f"Skill file:\n{out}")

mac.close()
print("\n[DONE]")
