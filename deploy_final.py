import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')

base = '/Users/fangjin/Desktop/p/docker-openclawd'

# Check .env and start.sh for all bots
for bot, path in [('Alin', 'deploy'), ('Lain', 'deploy-lain'), ('Lumi', 'deploy-lumi'), ('Aling', 'deploy-aling')]:
    print(f"=== {bot} ===")
    for f in ['.env', 'start.sh']:
        stdin, stdout, stderr = client.exec_command(f'cat {base}/{path}/{f} 2>/dev/null')
        print(f"--- {f} ---")
        print(stdout.read().decode())

client.close()
