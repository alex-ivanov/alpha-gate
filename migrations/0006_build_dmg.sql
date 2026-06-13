-- 0006_build_dmg.sql
-- Second build artifact (decision 0003): the first-install DMG, alongside the EdDSA-signed .app zip.
-- The DMG carries no EdDSA — notarization/Gatekeeper seal it and Sparkle never touches it. Both
-- nullable: a build may ship the zip only (the Sparkle enclosure is always object_key/ed_signature/length).
ALTER TABLE builds ADD COLUMN dmg_object_key TEXT;
ALTER TABLE builds ADD COLUMN dmg_length INTEGER;
