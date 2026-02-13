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
    

# Script to run on Mac Mini to patch deploy files
patch_js = """
const fs = require('fs');
const proxyPath = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/api-proxy.js';
const startPath = '/Users/fangjin/Desktop/p/docker-openclawd/deploy/start.sh';

try {
    // 1. Patch api-proxy.js
    if (fs.existsSync(proxyPath)) {
        console.log('Patching ' + proxyPath);
        let content = fs.readFileSync(proxyPath, 'utf8');
        let original = content;
        
        content = content.replace(
            "const TARGET_HOST = 'v3.codesome.cn';", 
            "const TARGET_HOST = 'host.docker.internal';"
        );
        
        if (content.includes("port: 443")) {
            content = content.replace("port: 443", "port: 8080");
        }
        
        if (content.includes("https.request")) {
            content = content.replace("https.request", "http.request");
        }
        
        if (content !== original) {
            fs.writeFileSync(proxyPath, content);
            console.log('Successfully patched api-proxy.js');
        } else {
            console.log('api-proxy.js already patched or pattern not found');
        }
    } else {
        console.error('api-proxy.js not found at ' + proxyPath);
    }

    // 2. Patch start.sh
    if (fs.existsSync(startPath)) {
        console.log('Patching ' + startPath);
        let content = fs.readFileSync(startPath, 'utf8');
        let original = content;
        
        if (content.includes('export ANTHROPIC_BASE_URL="https://v3.codesome.cn"')) {
            content = content.replace(
                'export ANTHROPIC_BASE_URL="https://v3.codesome.cn"', 
                'export ANTHROPIC_BASE_URL="http://127.0.0.1:8022"'
            );
        }
        
        if (content !== original) {
            fs.writeFileSync(startPath, content);
            console.log('Successfully patched start.sh');
        } else {
            console.log('start.sh already patched or pattern not found');
        }
    } else {
        console.error('start.sh not found at ' + startPath);
    }

} catch (e) {
    console.error('Error patching files:', e);
    process.exit(1);
}
"""

print("Creating patch script on Mac Mini...")
cmd_create_js = f"cat > /tmp/patch_deploy.js << 'EOF'\n{patch_js}\nEOF"
run_cmd(cmd_create_js)

print("Executing patch on Mac Mini host...")
run_cmd("/Users/fangjin/local/bin/node /tmp/patch_deploy.js")

print("Restarting deploy-openclaw-gateway-1 container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker restart deploy-openclaw-gateway-1")
