-- fispeak local schema (10-summary-export §3). Applied once on first launch.
-- turns.id is the sidecar chunk_id, so re-delivered chunks must NOT duplicate rows.

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pinned INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  my_lang TEXT,
  remote_lang TEXT,
  whisper_model TEXT,
  nllb_model TEXT,
  turn_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  tag TEXT CHECK (tag IN ('remote', 'you')),
  started_ms INTEGER,
  end_ms INTEGER,
  src_lang TEXT,
  tgt_lang TEXT,
  text_src TEXT,
  text_tgt TEXT,
  confidence REAL,
  quality TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id, started_ms);

CREATE TABLE IF NOT EXISTS summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT,
  model TEXT,
  content_md TEXT,
  created_at INTEGER NOT NULL
);
