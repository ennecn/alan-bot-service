-- Metroid Database Schema v2
-- Dual-mode: Classic (ST-compatible) + Enhanced (Metroid native)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- === Agents ===
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  card_json TEXT NOT NULL DEFAULT '{}',
  emotion_state TEXT NOT NULL DEFAULT '{"pleasure":0,"arousal":0,"dominance":0}',
  mode TEXT NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic','enhanced')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- === Memories ===
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL CHECK(type IN ('working','stm','semantic','episodic','procedural')),
  content TEXT NOT NULL,
  summary TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.7,
  privacy TEXT NOT NULL DEFAULT 'private' CHECK(privacy IN ('public','private','sensitive')),
  emotion_context TEXT,
  keywords TEXT,          -- comma-separated for fast keyword search
  source_message_id TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_recalled_at TEXT,
  faded_at TEXT,          -- null = active, set = faded (forgotten)
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_agent_type
  ON memories(agent_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_agent_importance
  ON memories(agent_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_agent_created
  ON memories(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_keywords
  ON memories(keywords);
CREATE INDEX IF NOT EXISTS idx_memories_faded
  ON memories(agent_id, faded_at);

-- === World Entries (Lorebook) ===
CREATE TABLE IF NOT EXISTS world_entries (
  id TEXT PRIMARY KEY,
  keywords TEXT NOT NULL,              -- comma-separated trigger keywords
  secondary_keywords TEXT,             -- comma-separated secondary keywords (ST selective)
  content TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','agent','user')),
  scope_target TEXT,                   -- agent_id or user_id when scope != 'all'
  enabled INTEGER NOT NULL DEFAULT 1,
  -- ST-compatible fields (used in classic mode)
  selective_logic TEXT CHECK(selective_logic IN ('AND_ANY','NOT_ALL','NOT_ANY','AND_ALL')),
  position TEXT CHECK(position IN ('before_char','after_char','before_an','after_an','at_depth')),
  depth INTEGER,                       -- only used when position = 'at_depth'
  probability INTEGER NOT NULL DEFAULT 100 CHECK(probability BETWEEN 0 AND 100),
  constant INTEGER NOT NULL DEFAULT 0, -- ST constant flag (always active)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_world_keywords
  ON world_entries(keywords);

-- === Behavioral Changes (Growth) ===
CREATE TABLE IF NOT EXISTS behavioral_changes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  observation TEXT NOT NULL,
  adaptation TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reverted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_behavioral_agent
  ON behavioral_changes(agent_id, active);

-- === Audit Log (append-only) ===
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,        -- 'agent:alin', 'user:xxx', 'system'
  action TEXT NOT NULL,       -- 'memory.create', 'emotion.update', etc.
  target TEXT,                -- target entity id
  details TEXT,               -- JSON details
  approved_by TEXT            -- null = auto, user_id = manual approval
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON audit_log(actor, timestamp DESC);
