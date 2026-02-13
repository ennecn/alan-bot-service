import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

# Client keys from Step 1
keys = {
    "Alin": "gw-alin-86f31cca5b0d93189ffca6887138ff41",
    "Lain": "gw-lain-a90e1ca5a2110905fd0cb1279f74fd75",
    "Aling": "gw-aling-5762340acf5576d395f6cb3969c88082",
    "Lumi": "gw-lumi-6076e75c20398d61fadace7a7c3c8b68"
}

base = '/Users/fangjin/Desktop/p/docker-openclawd'
host_paths = {
    'Alin': f'{base}/deploy/api-proxy.js',
    'Lain': f'{base}/deploy-lain/api-proxy.js',
    'Lumi': f'{base}/deploy-lumi/api-proxy.js',
    'Aling': f'{base}/deploy-aling/api-proxy.js',
}

# First, check Aling's docker-compose.yml and the deploy-aling directory
print("=== Checking Aling setup ===")
for cmd_desc, cmd in [
    ("Aling compose", f"cat {base}/deploy-aling/docker-compose.yml"),
    ("Aling dir", f"ls -la {base}/deploy-aling/"),
    ("Alin compose", f"cat {base}/deploy/docker-compose.yml"),
]:
    print(f"\n--- {cmd_desc} ---")
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode())

client.close()
