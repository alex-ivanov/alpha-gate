-- 0007_access_requests.sql
-- §13 — submissions from the public "request access" page (§13 IA #10). The admin reviews these and
-- invites or dismisses each. No FK to clients: a request is from someone who may not have a row yet.
CREATE TABLE access_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'handled' | 'dismissed'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_access_requests_status ON access_requests(status);
