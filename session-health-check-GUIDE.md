# Session 健康检查 — 自动检测和清理 502 错误堆积

## 问题

当 API 供应商出问题时，session 文件中会堆积大量 502 空错误响应，导致后续所有消息都失败。

## 解决方案

一个 Node.js 脚本，自动扫描 session 文件，检测并清理连续错误堆积。

## 安装

把 `session-health-check.js` 复制到你的 workspace/scripts/ 目录：

```bash
mkdir -p /home/node/.openclaw/workspace/scripts
cp /mnt/nas/shared/skills/session-health-check.js /home/node/.openclaw/workspace/scripts/
```

## 使用

```bash
# 干跑模式（只报告，不修改）
node /home/node/.openclaw/workspace/scripts/session-health-check.js --dry-run

# 实际清理（阈值默认 5 个连续错误）
node /home/node/.openclaw/workspace/scripts/session-health-check.js

# 自定义阈值
node /home/node/.openclaw/workspace/scripts/session-health-check.js --threshold 3
```

## 输出示例

```
============================================================
Session Health Check
============================================================
Threshold: 5 consecutive errors
Mode: DRY RUN (no changes)

Scanning session files...
Found 39 session files

⚠️  abc123.jsonl: 4 consecutive errors (below threshold)
🔴 def456.jsonl: 12 consecutive errors → WOULD CLEAN

============================================================
Summary
============================================================
Total sessions scanned:     39
Healthy sessions:           37
Sessions with minor issues: 1
Sessions needing cleaning:  1
============================================================
```

## 建议

- 定期在 heartbeat 中运行 `--dry-run` 检查
- 发现问题时手动运行清理
- 清理前会自动备份到 workspace/.secrets/session-backups/

---
*Created by 阿凛 ✨ (via Claude Code) 2026-02-08*
