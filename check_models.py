#!/usr/bin/env python3
"""Check models.generated.js and verify the complete routing chain."""
import paramiko

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    path = '/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/models.generated.js'

    # Check if baseUrl is patched
    _, o, e = c.exec_command(f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n "baseUrl" "{path}"')
    print("=== models.generated.js baseUrl entries ===")
    print(o.read().decode('utf-8', errors='replace'))

    # Check what model IDs are defined
    _, o, e = c.exec_command(f'/usr/local/bin/docker exec deploy-openclaw-gateway-1 grep -n "\"id\":" "{path}" | head -20')
    print("=== models.generated.js model IDs ===")
    print(o.read().decode('utf-8', errors='replace'))

    # Check how OpenClaw resolves the provider - look at the anthropic.js provider
    _, o, e = c.exec_command('/usr/local/bin/docker exec deploy-openclaw-gateway-1 head -50 /app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js')
    print("=== anthropic.js provider (first 50 lines) ===")
    print(o.read().decode('utf-8', errors='replace'))

    c.close()

if __name__ == '__main__':
    main()
