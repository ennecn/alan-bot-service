#!/usr/bin/env python3
import paramiko
import sys

def run_cmd(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    stdin, stdout, stderr = client.exec_command(cmd)
    
    # Wait for command to complete
    try:
        exit_status = stdout.channel.recv_exit_status()
    except:
        exit_status = -1
    
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    return exit_status
    

# Script to run on Mac Mini to patch start.sh
patch_sh = """
const fs = require('fs');
const path = '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling/start.sh';

try {
    console.log('Reading file: ' + path);
    if (!fs.existsSync(path)) {
        console.error('File not found!');
        process.exit(1);
    }
    
    let content = fs.readFileSync(path, 'utf8');
    
    // Modify ANTHROPIC_BASE_URL
    console.log('Patching BASE_URL...');
    
    // Replace https://v3.codesome.cn with http://127.0.0.1:8022
    if (content.includes('export ANTHROPIC_BASE_URL="https://v3.codesome.cn"')) {
        content = content.replace(
            'export ANTHROPIC_BASE_URL="https://v3.codesome.cn"', 
            'export ANTHROPIC_BASE_URL="http://127.0.0.1:8022"'
        );
        fs.writeFileSync(path, content);
        console.log('Successfully patched start.sh on host');
    } else {
        console.log('Pattern not found or already patched');
    }

} catch (e) {
    console.error('Error patching file:', e);
    process.exit(1);
}
"""

print("Creating patch script on Mac Mini...")
cmd_create_js = f"cat > /tmp/patch_start_sh.js << 'EOF'\n{patch_sh}\nEOF"
run_cmd(cmd_create_js)

print("Executing patch on Mac Mini host...")
run_cmd("/Users/fangjin/local/bin/node /tmp/patch_start_sh.js")

print("Verifying changes...")
run_cmd("grep 'ANTHROPIC_BASE_URL' /Users/fangjin/Desktop/p/docker-openclawd/deploy-aling/start.sh")

print("Restarting aling-gateway container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker restart aling-gateway")
