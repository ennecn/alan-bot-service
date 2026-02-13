import paramiko
import sys

HOST = '192.168.21.111'
USER = 'fangjin'
PASS = 'YYZZ54321!'
PATH_PREFIX = 'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/sbin:'

commands = [
    ("1. Gateway config", f'{PATH_PREFIX}; docker exec deploy-openclaw-gateway-1 sh -c "cat /home/node/.openclaw/openclaw.json" | python3 -c "import sys,json; d=json.load(sys.stdin); gw=d.get(\'gateway\',{{}}); print(\'Gateway config:\', json.dumps(gw, indent=2))"'),
    ("2. Docker port mappings", f'{PATH_PREFIX}; docker port deploy-openclaw-gateway-1'),
    ("3. Ports listening inside container", f'{PATH_PREFIX}; docker exec deploy-openclaw-gateway-1 sh -c "netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null || echo \'no netstat/ss\'"'),
    ("4. Container network info", f"""{PATH_PREFIX}; docker inspect deploy-openclaw-gateway-1 --format='{{{{range .NetworkSettings.Networks}}}}Network: {{{{.NetworkID}}}} IP: {{{{.IPAddress}}}}{{{{end}}}}'"""),
    ("5. Port bindings", f"""{PATH_PREFIX}; docker inspect deploy-openclaw-gateway-1 --format='{{{{json .HostConfig.PortBindings}}}}'"""),
    ("6. openclaw CLI on host", f'{PATH_PREFIX}; which openclaw 2>/dev/null || echo "openclaw not found on host"'),
    ("7. Claude Code info", f'{PATH_PREFIX}; which claude && claude --version 2>/dev/null || echo "claude not found"'),
    ("8. Claude config dir", f'{PATH_PREFIX}; ls -la ~/.claude/ 2>/dev/null || echo "no .claude dir"'),
    ("9. Claude settings.json", f'{PATH_PREFIX}; cat ~/.claude/settings.json 2>/dev/null || echo "no settings.json"'),
    ("10. Gateway env vars", f'{PATH_PREFIX}; docker exec deploy-openclaw-gateway-1 sh -c "env | grep -i gateway || echo \'no gateway env vars\'"'),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Connecting to {USER}@{HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)
    print("Connected!\n" + "="*80)

    for label, cmd in commands:
        print(f"\n{'='*80}")
        print(f"  {label}")
        print(f"{'='*80}")
        try:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
            out = stdout.read().decode('utf-8', errors='replace').strip()
            err = stderr.read().decode('utf-8', errors='replace').strip()
            if out:
                print(out)
            if err:
                print(f"[STDERR] {err}")
            if not out and not err:
                print("(no output)")
        except Exception as e:
            print(f"[ERROR] {e}")

    print(f"\n{'='*80}")
    print("  DONE - All commands executed")
    print(f"{'='*80}")

except Exception as e:
    print(f"Connection failed: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    client.close()
