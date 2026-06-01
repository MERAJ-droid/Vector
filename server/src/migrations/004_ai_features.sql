-- Phase 0: AI infrastructure tables and columns
-- Requires: CREATE EXTENSION IF NOT EXISTS vector; run once in Supabase SQL editor first

-- Add embedding column to file_versions for nomic-embed-text (768-dim)
ALTER TABLE file_versions
  ADD COLUMN IF NOT EXISTS embedding vector(768);

CREATE INDEX IF NOT EXISTS file_versions_embedding_idx
  ON file_versions
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Activity log: one row per 10-second batch window per room
-- Used by Code Guardian persistence and provenance activity timeline
CREATE TABLE IF NOT EXISTS file_activity_log (
  id              BIGSERIAL PRIMARY KEY,
  file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_user_count INTEGER NOT NULL DEFAULT 0,
  edit_count_in_batch INTEGER NOT NULL DEFAULT 0,
  content_snapshot TEXT,
  participants    JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS file_activity_log_file_id_idx ON file_activity_log (file_id, recorded_at DESC);

-- Agent insights cache: avoid regenerating the same AI result for the same input
-- TTL of 1 hour is enforced at query time (WHERE created_at > NOW() - INTERVAL '1 hour')
CREATE TABLE IF NOT EXISTS agent_insights (
  id          BIGSERIAL PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('provenance', 'temporal_query', 'session_narrative')),
  cache_key   TEXT NOT NULL,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, insight_type, cache_key)
);

CREATE INDEX IF NOT EXISTS agent_insights_lookup_idx ON agent_insights (file_id, insight_type, cache_key, created_at DESC);

-- Session narrations cache: generated once per version range, never regenerated
CREATE TABLE IF NOT EXISTS session_narrations (
  id                   BIGSERIAL PRIMARY KEY,
  file_id              INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version_range_start  INTEGER NOT NULL,
  version_range_end    INTEGER NOT NULL,
  narration            TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, version_range_start, version_range_end)
);