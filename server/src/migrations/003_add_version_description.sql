-- Phase 5: Add AI-generated description column to file_versions
-- Nullable — existing rows stay NULL, populated lazily by the describe endpoint (Phase 3)

ALTER TABLE file_versions
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN file_versions.description IS 'Optional AI-generated one-sentence summary of what changed in this version';
