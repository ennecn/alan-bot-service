#!/usr/bin/env python3
"""PTY wrapper for Claude Code CLI. Allocates a real PTY so Claude doesn't hang."""
import sys, os, pty, select, signal

def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: pty-wrap.py command [args...]", file=sys.stderr)
        sys.exit(1)

    pid, fd = pty.fork()
    if pid == 0:
        # Child: exec the command
        os.execvp(args[0], args)
    else:
        # Parent: relay output
        signal.signal(signal.SIGTERM, lambda *_: os.kill(pid, signal.SIGTERM))
        try:
            while True:
                r, _, _ = select.select([fd], [], [], 1.0)
                if r:
                    try:
                        data = os.read(fd, 65536)
                        if not data:
                            break
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                    except OSError:
                        break
        except KeyboardInterrupt:
            os.kill(pid, signal.SIGTERM)
        _, status = os.waitpid(pid, 0)
        sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)

if __name__ == '__main__':
    main()
