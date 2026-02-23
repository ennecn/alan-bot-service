#!/usr/bin/env python3
"""ssh_cmd.py - Unified SSH command executor for OpenClaw infrastructure.

Reads host config from NAS ssh-hosts.json. Uses key auth (preferred) + password fallback.
Replaces: ssh_macmini.py, ssh_vesper.py, ssh_router.py

Usage:
    python ssh_cmd.py macmini "docker ps"
    python ssh_cmd.py vesper "ls" "df -h"
    python ssh_cmd.py vps "systemctl status openclaw"
    python ssh_cmd.py macmini -f script.sh        # read commands from file (avoids shell escaping)
    python ssh_cmd.py macmini --file script.sh     # same as above
    python ssh_cmd.py --list
"""
import json, sys, os, platform
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── Config paths ────────────────────────────────────────────────────
def find_ssh_hosts():
    candidates = [
        Path("Z:/.credentials/ssh-hosts.json"),
        Path("/Users/fangjin/nas/.credentials/ssh-hosts.json"),
        Path("/mnt/nas/.credentials/ssh-hosts.json"),
    ]
    for p in candidates:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    print("ERROR: ssh-hosts.json not found on NAS", file=sys.stderr)
    sys.exit(1)

def find_ssh_key():
    """Find the user's ed25519 private key."""
    candidates = [
        Path.home() / ".ssh" / "id_ed25519",
        Path("/Users/fangjin/.ssh/id_ed25519"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return None

def get_vault_password(host_alias):
    """Get password from vault (NAS store.json) as fallback."""
    key_map = {
        "macmini": "SSH_PASSWORD_MACMINI",
        "vesper": "SSH_PASSWORD_VESPER",
        "router": "SSH_PASSWORD_ROUTER",
        "vps": "SSH_PASSWORD_VPS",
    }
    store_paths = [
        Path("Z:/.credentials/store.json"),
        Path("/Users/fangjin/nas/.credentials/store.json"),
        Path("/mnt/nas/.credentials/store.json"),
    ]
    key_name = key_map.get(host_alias)
    if not key_name:
        return None
    for p in store_paths:
        if p.exists():
            store = json.loads(p.read_text(encoding="utf-8"))
            cred = store.get("credentials", {}).get(key_name)
            if cred:
                return cred["value"]
    return None

def connect(host_alias):
    """Connect to a host using key auth (preferred) + password fallback."""
    import paramiko
    config = find_ssh_hosts()
    host_info = config["hosts"].get(host_alias)
    if not host_info:
        print(f"Unknown host: {host_alias}", file=sys.stderr)
        print(f"Available: {', '.join(config['hosts'].keys())}", file=sys.stderr)
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    host = host_info["host"]
    port = host_info.get("port", 22)
    user = host_info["user"]
    key_path = find_ssh_key()

    # Try key auth first
    if key_path:
        try:
            client.connect(host, port=port, username=user,
                         key_filename=key_path, timeout=10)
            return client
        except Exception:
            pass  # Fall through to password

    # Password fallback
    password = get_vault_password(host_alias)
    if password:
        client.connect(host, port=port, username=user,
                     password=password, timeout=10)
        return client

    print(f"No auth method available for {host_alias}", file=sys.stderr)
    print(f"  Key: {key_path or 'not found'}", file=sys.stderr)
    print(f"  Password: not in vault (add SSH_PASSWORD_{host_alias.upper()})", file=sys.stderr)
    sys.exit(1)

def run(host_alias, commands):
    """Execute commands on remote host."""
    client = connect(host_alias)
    for cmd in commands:
        if len(commands) > 1:
            print(f"=== {cmd} ===")
        stdin, stdout, stderr = client.exec_command(cmd)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err:
            print(err, end="" if err.endswith("\n") else "\n", file=sys.stderr)
        if len(commands) > 1:
            print()
    client.close()

def run_file(host_alias, file_path):
    """Execute a script file on remote host.

    Reads the file locally and sends it via paramiko, completely bypassing
    the local shell's interpretation of $, !, (), etc.
    This solves the multi-layer shell escaping problem when running complex
    commands from Windows → Mac/Linux via SSH.
    """
    script = Path(file_path).read_text(encoding="utf-8")
    client = connect(host_alias)
    stdin, stdout, stderr = client.exec_command(script)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, end="" if err.endswith("\n") else "\n", file=sys.stderr)
    client.close()

def run_cmd(cmd):
    """Convenience: single command to Mac Mini (backward compat)."""
    run("macmini", [cmd])

# ── CLI ─────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    if sys.argv[1] == "--list":
        config = find_ssh_hosts()
        for alias, info in config["hosts"].items():
            print(f"  {alias:<12} {info['user']}@{info['host']}:{info.get('port',22)}  ({info.get('description','')})")
        sys.exit(0)

    host_alias = sys.argv[1]
    args = sys.argv[2:]

    # --file / -f mode: read commands from a local file, bypassing shell escaping
    if len(args) >= 2 and args[0] in ("-f", "--file"):
        run_file(host_alias, args[1])
        return

    commands = args if args else ["echo 'Connected OK'; uname -a"]
    run(host_alias, commands)

if __name__ == "__main__":
    main()
