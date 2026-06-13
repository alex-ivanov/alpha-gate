-- 0001_clients.sql
CREATE TABLE clients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  token           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'revoked'
  pinned_build_id INTEGER,                          -- nullable; overrides stream resolution
  label           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clients_token ON clients(token);
