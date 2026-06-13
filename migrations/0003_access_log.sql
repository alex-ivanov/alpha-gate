-- 0003_access_log.sql
CREATE TABLE access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER,
  email         TEXT,                                -- denormalized; survives client deletion
  event         TEXT NOT NULL,                       -- 'check' | 'download' | 'update'
  short_version TEXT,
  build_number  INTEGER,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_access_log_client  ON access_log(client_id);
CREATE INDEX idx_access_log_created ON access_log(created_at);
