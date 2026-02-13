#!/usr/bin/env python3
"""Inspect the actual OpenClaw configs - api-proxy.js, start.sh, openclaw.json"""
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

mac = paramiko.SSHClient()
mac.set_missing_host_key_policy(paramiko.AutoAddPolicy())
mac.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

def run(cmd):
    stdin, stdout, stderr = mac.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace').strip()

base = '/Users/fangjin/Desktop/p/docker-openclawd'

# 1. deploy (alin) - the main one
print("=" * 60)
print("1. deploy (alin) - start.sh")
print("=" * 60)
print(run(f'cat {base}/deploy/start.sh'))

print("\n" + "=" * 60)
print("2. deploy (alin) - api-proxy.js (first 100 lines)")
print("=" * 60)
print(run(f'head -100 {base}/deploy/api-proxy.js'))

print("\n" + "=" * 60)
print("3. deploy (alin) - openclaw.json")
print("=" * 60)
print(run(f'cat {base}/deploy/config/openclaw.json'))

# 4. deploy-lain
print("\n" + "=" * 60)
print("4. deploy-lain - start.sh")
print("=" * 60)
print(run(f'cat {base}/deploy-lain/start.sh'))

print("\n" + "=" * 60)
print("5. deploy-lain - api-proxy.js (first 50 lines)")
print("=" * 60)
print(run(f'head -50 {base}/deploy-lain/api-proxy.js'))

print("\n" + "=" * 60)
print("6. deploy-lain - openclaw.json")
print("=" * 60)
print(run(f'cat {base}/deploy-lain/config/openclaw.json'))

# 7. deploy-lumi
print("\n" + "=" * 60)
print("7. deploy-lumi - openclaw.json")
print("=" * 60)
print(run(f'cat {base}/deploy-lumi/config/openclaw.json'))

# 8. deploy-aling
print("\n" + "=" * 60)
print("8. deploy-aling - openclaw.json")
print("=" * 60)
print(run(f'cat {base}/deploy-aling/config/openclaw.json'))

# 9. Check the deploy-lain api-proxy vs deploy api-proxy difference
print("\n" + "=" * 60)
print("9. api-proxy.js sizes comparison")
print("=" * 60)
print(run(f'wc -l {base}/deploy/api-proxy.js {base}/deploy-lain/api-proxy.js {base}/deploy-lumi/api-proxy.js {base}/deploy-aling/api-proxy.js'))

mac.close()
print("\n[DONE]")
