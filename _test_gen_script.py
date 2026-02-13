#!/usr/bin/env python3
"""Test the gen.py script logic locally by calling the API from the VPS."""
import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('138.68.44.141', port=2222, username='root')

# Upload the gen.py script to VPS for testing
import os
script_path = os.path.join(os.path.dirname(__file__), 'skill-image-gen', 'scripts', 'gen.py')
with open(script_path, 'r') as f:
    script_content = f.read()

# Write script to VPS
stdin, stdout, stderr = client.exec_command("cat > /tmp/test_gen.py << 'PYEOF'\n" + script_content + "\nPYEOF")
stdout.read()

# Run the script
print("Testing gen.py on VPS...")
print("=" * 60)
# Modify API_URL to use localhost since we're on the VPS
cmd = """cd /tmp && sed -i 's|http://138.68.44.141:8045|http://127.0.0.1:8045|' test_gen.py && python3 test_gen.py --prompt "A simple red circle on white background, minimalist" --outdir /tmp/test-img-gen"""

stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
out = stdout.read().decode()
err = stderr.read().decode()
print(f"STDOUT: {out}")
if err:
    print(f"STDERR: {err}")

# Check output files
stdin, stdout, stderr = client.exec_command("ls -la /tmp/test-img-gen/ 2>/dev/null")
out = stdout.read().decode()
print(f"\nFiles: {out}")

client.close()
print("Done!")
