#!/usr/bin/env python3
"""Check Alin container and gateway logs for recent activity."""
import paramiko
import sys

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

    # Container logs
    sys.stdout.buffer.write(b"=== Alin container logs (last 30) ===\n")
    _, o, e = c.exec_command('/usr/local/bin/docker logs deploy-openclaw-gateway-1 --tail 30 2>&1')
    sys.stdout.buffer.write(o.read())

    # Gateway log (last 10)
    sys.stdout.buffer.write(b"\n=== Gateway log (last 10) ===\n")
    _, o, e = c.exec_command('tail -10 /private/tmp/gateway-v2.log')
    sys.stdout.buffer.write(o.read())

    # Check if api-proxy is running in container
    sys.stdout.buffer.write(b"\n=== api-proxy process ===\n")
    _, o, e = c.exec_command('/usr/local/bin/docker exec deploy-openclaw-gateway-1 pgrep -fa api-proxy')
    sys.stdout.buffer.write(o.read())

    c.close()

if __name__ == '__main__':
    main()
