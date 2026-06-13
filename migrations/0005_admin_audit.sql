-- 0005_admin_audit.sql
CREATE TABLE admin_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL,                         -- from the Access JWT
  action      TEXT NOT NULL,                         -- e.g. 'client.revoke', 'build.withdraw', 'stream.assign'
  target      TEXT,                                  -- entity affected (email, build_number, stream)
  detail      TEXT,                                  -- JSON: params / before-after
  ip          TEXT,
  ray_id      TEXT,                                  -- Cloudflare Ray ID, to cross-reference platform logs
  prev_hash   TEXT,                                  -- hash of the previous row (chain)
  hash        TEXT NOT NULL,                         -- SHA-256(prev_hash ‖ canonical(entry)) — tamper-evidence
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at);
