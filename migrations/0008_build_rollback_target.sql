-- 0008_build_rollback_target.sql
-- §9/§13 #7 — an operator annotation marking a known-good build as the designated rollback target.
-- This is a LABEL ONLY, not a downgrade switch: Sparkle cannot downgrade, so a real rollback is a
-- roll-forward (rebuild the good code with a higher build_number, withdraw the bad one — see §9). The
-- flag records which build to roll forward FROM and surfaces it on the builds list / manage page; the
-- resolver (§8) is unaffected and keeps serving the highest available build.
ALTER TABLE builds ADD COLUMN rollback_target INTEGER NOT NULL DEFAULT 0;
