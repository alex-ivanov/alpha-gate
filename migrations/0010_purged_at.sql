-- Archive purge (storage lifecycle): when the R2 bytes of a WITHDRAWN build are deleted to reclaim
-- free-tier space, the D1 row is kept (build_number uniqueness, download/update counts, and the
-- audit chain stay intact) and stamped here. A purged build can be restored to "available" only
-- after re-uploading its archive — purged_at gates that. NULL = archive still present.
ALTER TABLE builds ADD COLUMN purged_at TEXT;
