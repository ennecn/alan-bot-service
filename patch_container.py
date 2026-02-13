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
    exit_status = stdout.channel.recv_exit_status()
    
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    return exit_status

# Script to modify api-proxy.js inside the container
patch_script = '''
const fs = require("fs");
const path = "/home/node/api-proxy.js";

try {
    let content = fs.readFileSync(path, "utf8");
    
    // Modify TARGET_HOST
    content = content.replace(
        "const TARGET_HOST = 'v3.codesome.cn';", 
        "const TARGET_HOST = 'host.docker.internal';"
    );
    
    // Modify TARGET_PORT (change 443 to 8080 for Codesome forwarding)
    // We need to be careful not to change ANTIGRAVITY_PORT which is 8045
    // The code has: 
    // const options = {
    //   hostname: TARGET_HOST,
    //   port: 443,
    
    content = content.replace("port: 443,", "port: 8080,");
    
    // Change https to http for the request
    content = content.replace(
        "const proxyReq = https.request(options", 
        "const proxyReq = http.request(options"
    );
    
    fs.writeFileSync(path, content);
    console.log("Successfully patched api-proxy.js");
} catch (e) {
    console.error("Error patching file:", e);
    process.exit(1);
}
'''

# Escape the script for command line
patch_script_escaped = patch_script.replace('"', '\\"').replace("'", "'\\''")

# Create a temporary node script in the container and run it
docker_cmd = f"PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker exec -i aling-gateway /bin/bash -c 'cat > /home/node/patch_proxy.js <<EOF\\n{patch_script}\\nEOF'"
print("Creating patch script...")
run_cmd(docker_cmd)

print("Running patch script...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker exec aling-gateway node /home/node/patch_proxy.js")

print("Validating changes...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker exec aling-gateway grep -E 'TARGET_HOST|port:|http.request' /home/node/api-proxy.js")

print("Restarting container...")
run_cmd("PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker restart aling-gateway")
