-- 0002_builds_streams.sql
CREATE TABLE builds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_version TEXT NOT NULL,                       -- human, e.g. '1.4.0'
  build_number  INTEGER NOT NULL UNIQUE,             -- machine CFBundleVersion, monotonic
  object_key    TEXT NOT NULL,                       -- R2 key of the archive
  ed_signature  TEXT NOT NULL,                       -- Sparkle EdDSA (from generate_appcast)
  length        INTEGER NOT NULL,
  min_os        TEXT,
  critical      INTEGER NOT NULL DEFAULT 0,          -- mandatory/critical update flag
  status        TEXT NOT NULL DEFAULT 'available',   -- 'available' | 'withdrawn'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE streams (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE                           -- e.g. 'stable', 'beta', 'canary'
);

CREATE TABLE build_streams (
  build_id  INTEGER NOT NULL REFERENCES builds(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  PRIMARY KEY (build_id, stream_id)
);

CREATE TABLE user_streams (
  client_id INTEGER NOT NULL REFERENCES clients(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  PRIMARY KEY (client_id, stream_id)
);
