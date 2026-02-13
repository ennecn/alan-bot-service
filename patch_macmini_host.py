#!/usr/bin/env python3
import paramiko
import sys
import time

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
    

# Script to run on Mac Mini to patch the file
patch_js = """
const fs = require('fs');
const path = '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling/api-proxy.js';

try {
    console.log('Reading file: ' + path);
    if (!fs.existsSync(path)) {
        console.error('File not found!');
        process.exit(1);
    }
    
    let content = fs.readFileSync(path, 'utf8');
    let original = content;
    
    // Modify TARGET_HOST
    console.log('Patching HOST...');
    content = content.replace(
        "const TARGET_HOST = 'v3.codesome.cn';", 
        "const TARGET_HOST = 'host.docker.internal';"
    );
    
    // Modify port for codesome forwarding
    console.log('Patching PORT...');
    if (content.includes("port: 443")) {
        content = content.replace("port: 443", "port: 8080");
    }
    
    // Change https to http for the request
    console.log('Patching HTTPS -> HTTP...');
    if (content.includes("https.request")) {
        content = content.replace("https.request", "http.request");
    }
    
    if (content === original) {
        console.log('No changes needed or pattern not found');
    } else {
        fs.writeFileSync(path, content);
        console.log('Successfully patched api-proxy.js on host');
    }
} catch (e) {
    console.error('Error patching file:', e);
    process.exit(1);
}
"""

print("Creating patch script on Mac Mini...")
# Write the Node.js script to a temp file on the Mac Mini
cmd_create_js = f"cat > /tmp/patch_host_proxy.js << 'EOF'\n{patch_js}\nEOF"
run_cmd(cmd_create_js)

print("Executing patch on Mac Mini host...")
run_cmd("node /tmp/patch_host_proxy.js")

print("Verifying changes...")
run_cmd("grep -E 'TARGET_HOST|port:|http.request' /Users/fangjin/Desktop/p/docker-openclawd/deploy-aling/api-proxy.js")

print("Restarting aling-gateway container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker restart aling-gateway")
