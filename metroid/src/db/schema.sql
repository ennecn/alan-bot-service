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
  embedding BLOB,         -- vector embedding for semantic search
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

-- === Entity Relations (GraphRAG) ===
CREATE TABLE IF NOT EXISTS entity_relations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  source_entity TEXT NOT NULL,
  relation TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  source_memory_id TEXT REFERENCES memories(id),
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_agent_source
  ON entity_relations(agent_id, source_entity);
CREATE INDEX IF NOT EXISTS idx_entity_agent_target
  ON entity_relations(agent_id, target_entity);

-- === Proactive Messages (pending outbound) ===
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  trigger_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','idle','emotion','event','impulse:idle','impulse:emotion','impulse:mixed')),
  content TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proactive_agent_pending
  ON proactive_messages(agent_id, delivered, created_at DESC);

-- === Proactive Reactions (V3: user feedback loop) ===
CREATE TABLE IF NOT EXISTS proactive_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  message_id TEXT NOT NULL REFERENCES proactive_messages(id),
  reaction TEXT NOT NULL CHECK(reaction IN ('engaged','ignored','dismissed')),
  response_latency_ms INTEGER,
  conversation_turns INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reactions_agent
  ON proactive_reactions(agent_id, created_at DESC);

-- === Proactive Preferences (V3: per-agent learned weights) ===
CREATE TABLE IF NOT EXISTS proactive_preferences (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  key TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, key)
);

-- === Impulse States (proactive impulse accumulator) ===
CREATE TABLE IF NOT EXISTS impulse_states (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  impulse_value REAL NOT NULL DEFAULT 0,
  last_decay_time TEXT NOT NULL DEFAULT (datetime('now')),
  last_fire_time TEXT,
  active_events TEXT NOT NULL DEFAULT '[]',
  suppression_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- === Long-Term Mood (cross-session emotional memory) ===
CREATE TABLE IF NOT EXISTS long_term_mood (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  dimension TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, dimension)
);

-- === V6: User Relationships (per-user emotional bond) ===
CREATE TABLE IF NOT EXISTS user_relationships (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT NOT NULL,
  attachment REAL NOT NULL DEFAULT 0,
  trust REAL NOT NULL DEFAULT 0,
  familiarity REAL NOT NULL DEFAULT 0,
  last_interaction TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, user_id)
);

-- === V6: Inner Monologues (agent inner thoughts) ===
CREATE TABLE IF NOT EXISTS inner_monologues (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT,
  trigger TEXT NOT NULL CHECK(trigger IN ('state_change','message_received','message_suppressed','event_detected','ambient')),
  content TEXT NOT NULL,
  emotion_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monologues_agent
  ON inner_monologues(agent_id, created_at DESC);
