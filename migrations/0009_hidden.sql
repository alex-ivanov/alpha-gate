-- Admin-list visibility: a soft "hide" that declutters the Users/Builds lists. UI-only — it does NOT
-- affect resolution or serving (a hidden available build still serves; a hidden user still gets updates).
-- Withdraw/revoke remain the functional controls. The list views exclude hidden rows by default and a
-- "show hidden" toggle reveals them.
ALTER TABLE clients ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE builds  ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
