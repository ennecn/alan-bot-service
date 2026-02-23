#!/usr/bin/env python3
"""DEPRECATED: Use ssh_cmd.py instead.
   python ssh_cmd.py macmini "command"
   python ssh_cmd.py macmini -f script.sh

This file is kept as a thin wrapper for backward compatibility.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ssh_cmd import run, run_cmd, run_file

if __name__ == "__main__":
    args = sys.argv[1:]
    # Support --file / -f mode
    if len(args) >= 2 and args[0] in ("-f", "--file"):
        run_file("macmini", args[1])
    else:
        cmd = " ".join(args) if args else 'docker ps --format "table {{.Names}}\\t{{.Status}}"'
        run("macmini", [cmd])
