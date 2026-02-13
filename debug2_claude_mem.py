#!/usr/bin/env python3
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    _, stdout, stderr = client.exec_command(f'bash -l -c {repr(cmd)}')
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Check actual log files
out, _ = run('ls -la ~/.claude-mem/logs/')
print(f"Log files:\n{out}")

# Read today's log
out, _ = run('cat ~/.claude-mem/logs/claude-mem-2026-02-12.log 2>/dev/null || echo "no log for today"')
print(f"\n=== Today's log ===\n{out[-2000:]}")

# Try save via curl with stderr
out, err = run('curl -s -w "\\nHTTP_CODE:%{http_code}" -X POST http://127.0.0.1:37777/api/memory/save -H "Content-Type: application/json" -d \'{"text":"test entry for debugging","title":"debug test","project":"test"}\'')
print(f"\n=== Save ===\nout: {out}\nerr: {err}")

# Check stats
out, _ = run('curl -s http://127.0.0.1:37777/api/stats')
print(f"\n=== Stats ===\n{out}")

client.close()
