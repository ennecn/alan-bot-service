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
    

# 1. Create the patch script file locally first, then copy via ssh
patch_js = """
const fs = require('fs');
const path = '/home/node/api-proxy.js';

try {
    console.log('Reading file...');
    let content = fs.readFileSync(path, 'utf8');
    
    // Modify TARGET_HOST
    console.log('Patching HOST...');
    content = content.replace(
        "const TARGET_HOST = 'v3.codesome.cn';", 
        "const TARGET_HOST = 'host.docker.internal';"
    );
    
    // Modify port for codesome forwarding
    console.log('Patching PORT...');
    // Look for the specific block for forwardToCodesome
    // changing ONLY the port: 443 inside that function or global definition
    // The previous regex was risky. Let's be specific.
    
    if (content.includes("port: 443")) {
        content = content.replace("port: 443", "port: 8080");
    }
    
    // Change https to http for the request
    console.log('Patching HTTPS -> HTTP...');
    if (content.includes("https.request")) {
        content = content.replace("https.request", "http.request");
    }
    
    fs.writeFileSync(path, content);
    console.log('Successfully patched api-proxy.js');
} catch (e) {
    console.error('Error patching file:', e);
    process.exit(1);
}
"""

# We need to construct a command that writes this JS to a file inside the container
# Best way is to write to a temp file on host, then docker cp, then exec

print("Creating patch.js on Mac Mini...")
cmd_create_js = f"cat > /tmp/patch_proxy.js << 'EOF'\n{patch_js}\nEOF"
run_cmd(cmd_create_js)

print("Copying patch.js to container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker cp /tmp/patch_proxy.js aling-gateway:/home/node/patch_proxy.js")

print("Executing patch inside container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker exec aling-gateway node /home/node/patch_proxy.js")

print("Verifying changes...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker exec aling-gateway grep -E 'TARGET_HOST|port:|http.request' /home/node/api-proxy.js")

print("Restarting container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker restart aling-gateway")
