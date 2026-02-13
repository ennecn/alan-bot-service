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
    

# List of deployments to fix
deployments = [
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy',
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lain',
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy-aling',
    '/Users/fangjin/Desktop/p/docker-openclawd/deploy-lumi'
]

# The patching logic (Node.js script)
patch_js = r"""
const fs = require('fs');
const path = require('path');

const deployPath = process.argv[2];
if (!deployPath) {
    console.error('Usage: node patch.js <deploy_path>');
    process.exit(1);
}

const composePath = path.join(deployPath, 'docker-compose.yml');

if (fs.existsSync(composePath)) {
    console.log('Patching ' + composePath);
    let content = fs.readFileSync(composePath, 'utf8');
    
    // Check if already has extra_hosts
    if (content.includes('extra_hosts:')) {
        console.log('extra_hosts already present');
        if (!content.includes('host.docker.internal:host-gateway')) {
            console.warn('extra_hosts present but might be missing host.docker.internal');
        }
    } else {
        // Insert extra_hosts after environment section (or image)
        // We look for '    environment:' allowing for indentation
        const envMatch = content.match(/(\s+)environment:/);
        if (envMatch) {
            const indent = envMatch[1];
            const insert = `
${indent}extra_hosts:
${indent}  - "host.docker.internal:host-gateway"`;
            
            // Insert before environment
            content = content.replace(envMatch[0], insert + '\n' + envMatch[0]);
            fs.writeFileSync(composePath, content);
            console.log('Added extra_hosts');
        } else {
             // Try '    image:'
             const imgMatch = content.match(/(\s+)image:/);
             if (imgMatch) {
                const indent = imgMatch[1];
                const insert = `
${indent}extra_hosts:
${indent}  - "host.docker.internal:host-gateway"`;
                content = content.replace(imgMatch[0], imgMatch[0] + '\n' + insert);
                fs.writeFileSync(composePath, content);
                console.log('Added extra_hosts after image');
             } else {
                 console.error('Could not find insertion point (environment or image keys missing)');
             }
        }
    }
} else {
    console.error('docker-compose.yml not found at ' + composePath);
}
"""

print("Creating compose patch script on Mac Mini...")
cmd_create_js = f"cat > /tmp/patch_compose.js << 'EOF'\n{patch_js}\nEOF"
run_cmd(cmd_create_js)


for deploy_path in deployments:
    print(f"\n--- Processing {deploy_path} ---")
    
    print(f"Patching docker-compose.yml...")
    run_cmd(f"/Users/fangjin/local/bin/node /tmp/patch_compose.js \"{deploy_path}\"")
    
    print(f"Recreating container(s) with docker-compose up -d...")
    # Using full path to docker-compose if needed? Or docker compose (v2)?
    # Assuming docker-compose is in path or alias. 
    # Usually /usr/local/bin/docker-compose or docker compose plugin.
    # We try typical paths.
    
    # We use 'docker compose' (v2 plugin) if available, or 'docker-compose'.
    # Checking availability:
    # run_cmd("docker compose version") -> if success use it.
    
    # Let's try explicit path update and command 'docker-compose'
    cmd = f"cd {deploy_path} && PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH docker-compose up -d"
    run_cmd(cmd)
    
    time.sleep(2)

print("\nAll compose files updated and containers recreated.")
