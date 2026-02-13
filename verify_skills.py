#!/usr/bin/env python3
"""Final comprehensive skill accessibility check for all bots."""
import paramiko

BASE = '/Users/fangjin/Desktop/p/docker-openclawd'
BOTS = [
    ('deploy', 'deploy-openclaw-gateway-1', '阿凛'),
    ('deploy-aling', 'aling-gateway', '阿澪'),
    ('deploy-lain', 'lain-gateway', 'Lain'),
    ('deploy-lumi', 'lumi-gateway', 'Lumi'),
]

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('192.168.21.111', username='fangjin', password='YYZZ54321!')
    sftp = c.open_sftp()

    for deploy_dir, container, name in BOTS:
        print(f'=== {name} ({container}) ===')

        # Collect all skills from all sources
        config_path = f'{BASE}/{deploy_dir}/config/skills'
        ws_path = f'{BASE}/{deploy_dir}/workspace/skills'

        try:
            config_skills = set(sftp.listdir(config_path))
        except Exception:
            config_skills = set()

        try:
            ws_skills = set(sftp.listdir(ws_path))
        except Exception:
            ws_skills = set()

        all_skills = sorted(config_skills | ws_skills)

        for skill in all_skills:
            # Check if this skill has a top-level SKILL.md (single skill vs skill pack)
            has_top_skill = False
            for check_dir in [config_path, ws_path]:
                try:
                    sftp.stat(f'{check_dir}/{skill}/SKILL.md')
                    has_top_skill = True
                    break
                except Exception:
                    pass

            if not has_top_skill:
                # Skill pack or special structure - check if it has nested skills
                nested_count = 0
                for check_dir in [config_path, ws_path]:
                    try:
                        cmd = f'find {check_dir}/{skill} -name SKILL.md 2>/dev/null | wc -l'
                        _, o, e = c.exec_command(cmd)
                        nested_count = max(nested_count, int(o.read().decode().strip()))
                    except Exception:
                        pass
                source = 'config' if skill in config_skills else 'workspace'
                print(f'  {skill}: skill-pack ({nested_count} sub-skills) [{source}]')
                continue

            # Single skill - check all 3 container paths
            paths = {
                'managed': f'/home/node/.openclaw/skills/{skill}/SKILL.md',
                'workspace': f'/home/node/.openclaw/workspace/skills/{skill}/SKILL.md',
                'bundled': f'/app/skills/{skill}/SKILL.md',
            }
            results = {}
            for label, p in paths.items():
                cmd = f'/usr/local/bin/docker exec {container} test -f "{p}" && echo OK || echo FAIL'
                _, o, e = c.exec_command(cmd)
                results[label] = o.read().decode().strip()

            ok_count = sum(1 for v in results.values() if v == 'OK')
            source = 'config+ws' if skill in config_skills and skill in ws_skills else ('config' if skill in config_skills else 'workspace')

            if ok_count == 3:
                print(f'  {skill}: OK (3/3 paths) [{source}]')
            else:
                fails = [k for k, v in results.items() if v != 'OK']
                print(f'  {skill}: {ok_count}/3 paths - MISSING: {", ".join(fails)} [{source}]')

        print()

    sftp.close()
    c.close()

if __name__ == '__main__':
    main()
